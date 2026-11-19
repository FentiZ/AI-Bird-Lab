using System.Data;
using System.Text.Json;
using Microsoft.Data.SqlClient;

public class Database
{
    private readonly string connectionString;
    public Database(IConfiguration config) => connectionString = config.GetConnectionString("BirdLab")
        ?? throw new Exception("Missing BirdLab connection string");
    private SqlConnection Connect() => new(connectionString);

    public async Task InitializeAsync()
    {
        var builder = new SqlConnectionStringBuilder(connectionString);
        string name = builder.InitialCatalog;
        if (string.IsNullOrWhiteSpace(name)) throw new Exception("Missing database name");
        builder.InitialCatalog = "master";
        await using (var master = new SqlConnection(builder.ConnectionString))
        {
            await master.OpenAsync();
            var safe = name.Replace("]", "]]", StringComparison.Ordinal);
            await using var cmd = new SqlCommand($"IF DB_ID(@db) IS NULL EXEC('CREATE DATABASE [{safe}]')", master);
            cmd.Parameters.AddWithValue("@db", name);
            await cmd.ExecuteNonQueryAsync();
        }

        await using var db = Connect();
        await db.OpenAsync();
        const string sql = """
        IF OBJECT_ID('dbo.Analyses', 'U') IS NULL
        BEGIN
            CREATE TABLE dbo.Analyses (
                Id INT IDENTITY(1,1) PRIMARY KEY,
                Wallet NVARCHAR(42) NOT NULL,
                Status NVARCHAR(20) NOT NULL DEFAULT 'queued',
                Error NVARCHAR(500) NOT NULL DEFAULT '',
                ImageName NVARCHAR(260) NOT NULL,
                ImageData VARBINARY(MAX) NOT NULL,
                ImageMime NVARCHAR(50) NOT NULL,
                PredictedSpecies NVARCHAR(200) NOT NULL DEFAULT '',
                Confidence FLOAT NOT NULL DEFAULT 0,
                AnalysisDate DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
                Description NVARCHAR(1000) NOT NULL DEFAULT '',
                BirdInfoJson NVARCHAR(MAX) NOT NULL DEFAULT 'null',
                Top3Json NVARCHAR(MAX) NOT NULL DEFAULT '[]'
            );
        END
        ELSE
        BEGIN
            IF COL_LENGTH('dbo.Analyses','Wallet') IS NULL ALTER TABLE dbo.Analyses ADD Wallet NVARCHAR(42) NOT NULL DEFAULT 'legacy';
            IF COL_LENGTH('dbo.Analyses','Status') IS NULL ALTER TABLE dbo.Analyses ADD Status NVARCHAR(20) NOT NULL DEFAULT 'done';
            IF COL_LENGTH('dbo.Analyses','Error') IS NULL ALTER TABLE dbo.Analyses ADD Error NVARCHAR(500) NOT NULL DEFAULT '';
        END;
        """;
        await using var create = new SqlCommand(sql, db);
        await create.ExecuteNonQueryAsync();
    }

    public async Task<int> AddPendingAsync(string wallet, string filename, byte[] image, string mime)
    {
        await using var db = Connect();
        await db.OpenAsync();
        await using var cmd = new SqlCommand("""
            INSERT INTO dbo.Analyses (Wallet,ImageName,ImageData,ImageMime,Status)
            OUTPUT INSERTED.Id VALUES (@wallet,@name,@data,@mime,'queued')
            """, db);
        cmd.Parameters.Add("@wallet", SqlDbType.NVarChar, 42).Value = wallet;
        cmd.Parameters.Add("@name", SqlDbType.NVarChar, 260).Value = filename;
        cmd.Parameters.Add("@data", SqlDbType.VarBinary, -1).Value = image;
        cmd.Parameters.Add("@mime", SqlDbType.NVarChar, 50).Value = mime;
        return (int)(await cmd.ExecuteScalarAsync() ?? throw new Exception("Insert failed"));
    }

    public async Task CompleteAsync(int id, AiResponse ai, Bird? bird)
    {
        await using var db = Connect();
        await db.OpenAsync();
        await using var cmd = new SqlCommand("""
            UPDATE dbo.Analyses SET Status='done',Error='',PredictedSpecies=@species,Confidence=@conf,
              Description=@description,BirdInfoJson=@bird,Top3Json=@top
            WHERE Id=@id AND Status IN ('queued','failed')
            """, db);
        cmd.Parameters.AddWithValue("@id", id);
        cmd.Parameters.Add("@species", SqlDbType.NVarChar, 200).Value = ai.PredictedSpecies[..Math.Min(200, ai.PredictedSpecies.Length)];
        cmd.Parameters.AddWithValue("@conf", ai.Confidence);
        cmd.Parameters.Add("@description", SqlDbType.NVarChar, 1000).Value = bird?.Description ?? "Немає перевіреної інформації у довіднику.";
        cmd.Parameters.Add("@bird", SqlDbType.NVarChar, -1).Value = JsonSerializer.Serialize(bird);
        cmd.Parameters.Add("@top", SqlDbType.NVarChar, -1).Value = JsonSerializer.Serialize(ai.Top3);
        await cmd.ExecuteNonQueryAsync();
    }

    public async Task MarkNotBirdAsync(int id)
    {
        await using var db = Connect();
        await db.OpenAsync();
        await using var cmd = new SqlCommand("""
            UPDATE dbo.Analyses SET Status='not_bird', Error=@reason,
                PredictedSpecies='', Confidence=0, Description='', BirdInfoJson='null', Top3Json='[]'
            WHERE Id=@id AND Status IN ('queued','failed')
            """, db);
        cmd.Parameters.AddWithValue("@id", id);
        cmd.Parameters.Add("@reason", SqlDbType.NVarChar, 500).Value = "На фото не виявлено птаха. Завантажте іншу фотографію.";
        await cmd.ExecuteNonQueryAsync();
    }

    public async Task FailAsync(int id, string error)
    {
        await using var db = Connect();
        await db.OpenAsync();
        await using var cmd = new SqlCommand("UPDATE dbo.Analyses SET Status='failed', Error=@error WHERE Id=@id AND Status='queued'", db);
        cmd.Parameters.AddWithValue("@id", id);
        cmd.Parameters.Add("@error", SqlDbType.NVarChar, 500).Value = error[..Math.Min(500, error.Length)];
        await cmd.ExecuteNonQueryAsync();
    }

    private static Analysis Read(SqlDataReader row) => new()
    {
        Id = row.GetInt32(0), ImageName = row.GetString(1), PredictedSpecies = row.GetString(2),
        Confidence = row.GetDouble(3), AnalysisDate = row.GetFieldValue<DateTimeOffset>(4),
        Description = row.GetString(5), BirdInfo = JsonSerializer.Deserialize<Bird>(row.GetString(6)),
        Top3 = JsonSerializer.Deserialize<List<Prediction>>(row.GetString(7)) ?? new(),
        Status = row.GetString(8), Error = row.GetString(9)
    };

    public async Task<List<Analysis>> GetAllAsync(string wallet, string search = "")
    {
        var list = new List<Analysis>();
        await using var db = Connect();
        await db.OpenAsync();
        await using var cmd = new SqlCommand("""
            SELECT Id,ImageName,PredictedSpecies,Confidence,AnalysisDate,Description,BirdInfoJson,Top3Json,Status,Error
            FROM dbo.Analyses WHERE Wallet=@wallet AND (PredictedSpecies LIKE @search OR ImageName LIKE @search)
            ORDER BY Id DESC
            """, db);
        cmd.Parameters.Add("@wallet", SqlDbType.NVarChar, 42).Value = wallet;
        cmd.Parameters.Add("@search", SqlDbType.NVarChar, 400).Value = "%" + search[..Math.Min(150, search.Length)] + "%";
        await using var reader = await cmd.ExecuteReaderAsync();
        while (await reader.ReadAsync()) list.Add(Read(reader));
        return list;
    }

    public async Task<Analysis?> GetByIdAsync(int id, string wallet)
    {
        await using var db = Connect();
        await db.OpenAsync();
        await using var cmd = new SqlCommand("""
            SELECT Id,ImageName,PredictedSpecies,Confidence,AnalysisDate,Description,BirdInfoJson,Top3Json,Status,Error
            FROM dbo.Analyses WHERE Id=@id AND Wallet=@wallet
            """, db);
        cmd.Parameters.AddWithValue("@id", id);
        cmd.Parameters.AddWithValue("@wallet", wallet);
        await using var reader = await cmd.ExecuteReaderAsync();
        return await reader.ReadAsync() ? Read(reader) : null;
    }

    public async Task<(byte[] Data, string Mime)?> GetImageAsync(int id, string? wallet = null)
    {
        await using var db = Connect();
        await db.OpenAsync();
        await using var cmd = new SqlCommand(
            wallet == null ? "SELECT ImageData,ImageMime FROM dbo.Analyses WHERE Id=@id"
                           : "SELECT ImageData,ImageMime FROM dbo.Analyses WHERE Id=@id AND Wallet=@wallet", db);
        cmd.Parameters.AddWithValue("@id", id);
        if (wallet != null) cmd.Parameters.AddWithValue("@wallet", wallet);
        await using var row = await cmd.ExecuteReaderAsync();
        return await row.ReadAsync() ? (row.GetFieldValue<byte[]>(0), row.GetString(1)) : null;
    }

    public async Task<bool> DeleteAsync(int id, string wallet)
    {
        await using var db = Connect();
        await db.OpenAsync();
        await using var cmd = new SqlCommand("DELETE FROM dbo.Analyses WHERE Id=@id AND Wallet=@wallet", db);
        cmd.Parameters.AddWithValue("@id", id);
        cmd.Parameters.AddWithValue("@wallet", wallet);
        return await cmd.ExecuteNonQueryAsync() > 0;
    }
}
