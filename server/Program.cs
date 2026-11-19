using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Security.Cryptography;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddSingleton<Database>();
builder.Services.AddSingleton<AuthTokens>();
builder.Services.AddSingleton<RabbitPublisher>();
builder.Services.AddHttpClient("chain", client =>
{
    client.BaseAddress = new Uri(builder.Configuration["BlockchainServiceUrl"] ?? "http://127.0.0.1:3001");
    client.Timeout = TimeSpan.FromSeconds(12);
});
builder.Services.AddCors(options => options.AddDefaultPolicy(policy => policy
    .WithOrigins("http://localhost:5173", "http://127.0.0.1:5173")
    .AllowAnyHeader().AllowAnyMethod()));

var app = builder.Build();
app.UseCors();
var birds = JsonSerializer.Deserialize<List<Bird>>(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "birds.json"))) ?? new();

// SQL Server may need time to become ready after Docker starts.
var db = app.Services.GetRequiredService<Database>();
for (int attempt = 1; attempt <= 45; attempt++)
{
    try { await db.InitializeAsync(); break; }
    catch (Exception e)
    {
        if (attempt == 45) throw;
        Console.WriteLine($"SQL not ready ({attempt}/45): {e.Message}");
        await Task.Delay(4000);
    }
}

bool IsWorker(HttpRequest request) => BirdLogic.IsWorkerKey(
    request.Headers["X-Worker-Key"].ToString(), app.Configuration["InternalWorkerKey"]);

async Task<(bool Active, long Expiry)> CheckSubscription(string wallet, IHttpClientFactory factory)
{
    using var response = await factory.CreateClient("chain").GetAsync("/active/" + wallet);
    response.EnsureSuccessStatusCode();
    var json = await response.Content.ReadFromJsonAsync<JsonElement>();
    return (json.GetProperty("active").GetBoolean(), json.GetProperty("expiresAt").GetInt64());
}

app.MapGet("/api/health", () => Results.Ok(new { status = "ok", service = "BirdLab API" }));
app.MapGet("/api/birds", () => Results.Ok(birds));
app.MapGet("/api/blockchain", async (IHttpClientFactory http) =>
{
    try
    {
        var response = await http.CreateClient("chain").GetAsync("/info");
        return Results.Content(await response.Content.ReadAsStringAsync(), "application/json", statusCode: (int)response.StatusCode);
    }
    catch { return Results.Problem("Blockchain gateway is unavailable", statusCode: 503); }
});

app.MapGet("/api/auth/challenge", async (IHttpClientFactory http) =>
{
    try
    {
        var response = await http.CreateClient("chain").GetAsync("/challenge");
        return Results.Content(await response.Content.ReadAsStringAsync(), "application/json", statusCode: (int)response.StatusCode);
    }
    catch { return Results.Problem("Blockchain gateway is unavailable", statusCode: 503); }
});

app.MapPost("/api/auth/verify", async (HttpRequest request, IHttpClientFactory http, AuthTokens auth) =>
{
    try
    {
        var input = await request.ReadFromJsonAsync<JsonElement>();
        using var response = await http.CreateClient("chain").PostAsJsonAsync("/verify", input);
        if (!response.IsSuccessStatusCode) return Results.Unauthorized();
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        string wallet = json.GetProperty("wallet").GetString()!;
        return Results.Ok(new { wallet, token = auth.Issue(wallet) });
    }
    catch { return Results.Problem("Unable to verify signature", statusCode: 503); }
});

app.MapGet("/api/auth/me", async (HttpRequest request, AuthTokens auth, IHttpClientFactory http) =>
{
    string? wallet = auth.Wallet(request);
    if (wallet == null) return Results.Unauthorized();
    try
    {
        var (active, expiry) = await CheckSubscription(wallet, http);
        return Results.Ok(new { wallet, active, expiresAt = expiry });
    }
    catch { return Results.Problem("Blockchain unavailable", statusCode: 503); }
});

app.MapPost("/api/analyze", async (HttpRequest request, AuthTokens auth, IHttpClientFactory http,
    Database database, RabbitPublisher rabbit) =>
{
    string? wallet = auth.Wallet(request);
    if (wallet == null) return Results.Unauthorized();
    try
    {
        var (active, _) = await CheckSubscription(wallet, http);
        if (!active) return Results.Json(new { error = "Active subscription required" }, statusCode: 402);
    }
    catch { return Results.Problem("Blockchain unavailable", statusCode: 503); }

    if (!request.HasFormContentType) return Results.BadRequest(new { error = "Use multipart/form-data" });
    var form = await request.ReadFormAsync();
    var file = form.Files.GetFile("file");
    if (file == null || file.Length == 0) return Results.BadRequest(new { error = "Choose a photo" });
    if (file.Length > 10 * 1024 * 1024) return Results.BadRequest(new { error = "Maximum image size is 10 MB" });
    if (!BirdLogic.IsAllowedPhoto(file.FileName))
        return Results.BadRequest(new { error = "Only JPG/JPEG/PNG" });
    await using var memory = new MemoryStream();
    await file.CopyToAsync(memory);
    byte[] bytes = memory.ToArray();
    string? mime = BirdLogic.DetectImageMime(bytes);
    if (mime == null) return Results.BadRequest(new { error = "Invalid JPEG/PNG file" });
    var extension = Path.GetExtension(file.FileName).ToLowerInvariant();
    if ((extension == ".png" && mime != "image/png") ||
        ((extension == ".jpg" || extension == ".jpeg") && mime != "image/jpeg"))
        return Results.BadRequest(new { error = "File extension does not match image content" });

    int id = await database.AddPendingAsync(wallet, Path.GetFileName(file.FileName), bytes, mime);
    try { rabbit.Send(id); }
    catch (Exception e)
    {
        Console.WriteLine("RabbitMQ publish failed: " + e.Message);
        await database.FailAsync(id, "RabbitMQ unavailable");
        return Results.Problem("RabbitMQ unavailable. Job was not queued.", statusCode: 503);
    }
    return Results.Accepted($"/api/analyses/{id}", await database.GetByIdAsync(id, wallet));
});

app.MapGet("/api/analyses", async (HttpRequest request, AuthTokens auth, Database database, string? search) =>
{
    string? wallet = auth.Wallet(request);
    return wallet == null ? (IResult)Results.Unauthorized() : Results.Ok(await database.GetAllAsync(wallet, search ?? ""));
});
app.MapGet("/api/analyses/{id:int}", async (HttpRequest request, AuthTokens auth, Database database, int id) =>
{
    string? wallet = auth.Wallet(request);
    if (wallet == null) return Results.Unauthorized();
    var result = await database.GetByIdAsync(id, wallet);
    return result == null ? (IResult)Results.NotFound() : Results.Ok(result);
});
app.MapGet("/api/analyses/{id:int}/image", async (HttpRequest request, AuthTokens auth, Database database, int id) =>
{
    string? wallet = auth.Wallet(request);
    if (wallet == null) return Results.Unauthorized();
    var result = await database.GetImageAsync(id, wallet);
    return result == null ? (IResult)Results.NotFound() : Results.File(result.Value.Data, result.Value.Mime);
});
app.MapDelete("/api/analyses/{id:int}", async (HttpRequest request, AuthTokens auth, Database database, int id) =>
{
    string? wallet = auth.Wallet(request);
    if (wallet == null) return Results.Unauthorized();
    return await database.DeleteAsync(id, wallet) ? (IResult)Results.NoContent() : Results.NotFound();
});
app.MapGet("/api/stats", async (HttpRequest request, AuthTokens auth, Database database) =>
{
    string? wallet = auth.Wallet(request);
    if (wallet == null) return Results.Unauthorized();
    var rows = await database.GetAllAsync(wallet);
    return Results.Ok(BirdLogic.CalculateStats(rows));
});
app.MapGet("/api/export", async (HttpRequest request, AuthTokens auth, Database database) =>
{
    string? wallet = auth.Wallet(request);
    if (wallet == null) return Results.Unauthorized();
    return Results.File(BirdLogic.ExportCsv(await database.GetAllAsync(wallet)), "text/csv", "bird_analysis.csv");
});

// Internal worker routes. Only the Python worker should know the shared key.
app.MapGet("/internal/jobs/{id:int}/image", async (HttpRequest request, Database database, int id) =>
{
    if (!IsWorker(request)) return Results.Unauthorized();
    var result = await database.GetImageAsync(id);
    return result == null ? (IResult)Results.NotFound() : Results.File(result.Value.Data, result.Value.Mime);
});
app.MapPost("/internal/jobs/{id:int}/complete", async (HttpRequest request, Database database, int id) =>
{
    if (!IsWorker(request)) return Results.Unauthorized();
    AiResponse? ai;
    try
    {
        ai = await request.ReadFromJsonAsync<AiResponse>(new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
    }
    catch { return Results.BadRequest(new { error = "Invalid prediction" }); }
    if (!BirdLogic.ValidPrediction(ai))
        return Results.BadRequest(new { error = "Invalid prediction" });
    if (!ai!.IsBird)
    {
        await database.MarkNotBirdAsync(id);
        return Results.Ok(new { ok = true, isBird = false });
    }
    var name = BirdLogic.NormalizeSpecies(ai.PredictedSpecies);
    var bird = birds.FirstOrDefault(x => x.EnglishName.Equals(name, StringComparison.OrdinalIgnoreCase));
    await database.CompleteAsync(id, ai, bird);
    return Results.Ok(new { ok = true });
});
app.MapPost("/internal/jobs/{id:int}/fail", async (HttpRequest request, Database database, int id) =>
{
    if (!IsWorker(request)) return Results.Unauthorized();
    var payload = await request.ReadFromJsonAsync<JsonElement>();
    string error = payload.TryGetProperty("error", out var message) ? message.GetString() ?? "AI error" : "AI error";
    await database.FailAsync(id, error);
    return Results.Ok(new { ok = true });
});
app.Run();
