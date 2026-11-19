using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

// Pure logic separated from HTTP/SQL so it can be unit-tested without Docker.
public static class BirdLogic
{
    public static string? DetectImageMime(byte[] bytes)
    {
        if (bytes.Length >= 8 && bytes[0] == 0x89 && bytes[1] == 0x50 && bytes[2] == 0x4E && bytes[3] == 0x47
            && bytes[4] == 0x0D && bytes[5] == 0x0A && bytes[6] == 0x1A && bytes[7] == 0x0A)
            return "image/png";
        if (bytes.Length >= 3 && bytes[0] == 0xFF && bytes[1] == 0xD8 && bytes[2] == 0xFF)
            return "image/jpeg";
        return null;
    }

    public static bool IsAllowedPhoto(string filename) =>
        new[] { ".jpg", ".jpeg", ".png" }.Contains(Path.GetExtension(filename).ToLowerInvariant());

    public static bool ValidPrediction(AiResponse? ai) =>
        ai != null && double.IsFinite(ai.BirdConfidence) && ai.BirdConfidence >= 0 && ai.BirdConfidence <= 100
        && (ai.IsBird ? !string.IsNullOrWhiteSpace(ai.PredictedSpecies) : string.IsNullOrEmpty(ai.PredictedSpecies))
        && ai.Top3 != null && (ai.IsBird ? ai.Top3.Count >= 1 : ai.Top3.Count == 0)
        && double.IsFinite(ai.Confidence) && ai.Confidence >= 0 && ai.Confidence <= 100
        && ai.Top3.All(p => !string.IsNullOrWhiteSpace(p.Species)
            && double.IsFinite(p.Confidence) && p.Confidence >= 0 && p.Confidence <= 100);

    public static string NormalizeSpecies(string name) =>
        Regex.Replace(name, @"^\s*\d+[.\-_ ]+", "").Replace('_', ' ').Trim();

    public static bool IsWorkerKey(string? provided, string? expected)
    {
        byte[] actual = Encoding.UTF8.GetBytes(provided ?? "");
        byte[] secret = Encoding.UTF8.GetBytes(expected ?? "");
        return secret.Length > 16 && CryptographicOperations.FixedTimeEquals(
            SHA256.HashData(actual), SHA256.HashData(secret));
    }

    public static object CalculateStats(IEnumerable<Analysis> source)
    {
        var all = source.ToList();
        var done = all.Where(x => x.Status == "done").ToList();
        return new
        {
            total = done.Count,
            queued = all.Count(x => x.Status == "queued"),
            species = done.GroupBy(x => x.PredictedSpecies)
                .Select(g => new { species = g.Key, count = g.Count() })
                .OrderByDescending(x => x.count).Take(10).ToList(),
            highest = done.MaxBy(x => x.Confidence),
            lowest = done.MinBy(x => x.Confidence)
        };
    }

    private static string CsvField(string? value) => "\"" + (value ?? "").Replace("\"", "\"\"") + "\"";

    public static byte[] ExportCsv(IEnumerable<Analysis> rows)
    {
        var csv = new StringBuilder("image_name,predicted_species,confidence,analysis_date,description,status\r\n");
        foreach (var row in rows.Where(x => x.Status == "done"))
            csv.Append(CsvField(row.ImageName)).Append(',').Append(CsvField(row.PredictedSpecies)).Append(',')
                .Append(row.Confidence.ToString(System.Globalization.CultureInfo.InvariantCulture)).Append(',')
                .Append(CsvField(row.AnalysisDate.ToString("O"))).Append(',')
                .Append(CsvField(row.Description)).Append(",done\r\n");
        return Encoding.UTF8.GetBytes("\uFEFF" + csv);
    }
}
