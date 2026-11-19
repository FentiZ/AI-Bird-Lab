using System.Globalization;
using System.Security.Cryptography;
using System.Text;

// Small signed bearer token for a local classroom demonstration (not OAuth).
public class AuthTokens
{
    private readonly byte[] key;

    public AuthTokens(IConfiguration config)
    {
        var secret = config["Auth:Key"] ?? "";
        if (secret.Length < 32) throw new Exception("Auth__Key must contain at least 32 characters");
        key = Encoding.UTF8.GetBytes(secret);
    }

    private static string Base64Url(byte[] input) => Convert.ToBase64String(input).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    public string Issue(string wallet)
    {
        string text = wallet.ToLowerInvariant() + "." + DateTimeOffset.UtcNow.AddDays(7).ToUnixTimeSeconds().ToString(CultureInfo.InvariantCulture)
            + "." + Base64Url(RandomNumberGenerator.GetBytes(8));
        using var hmac = new HMACSHA256(key);
        return text + "." + Base64Url(hmac.ComputeHash(Encoding.UTF8.GetBytes(text)));
    }

    public string? Wallet(HttpRequest request)
    {
        string header = request.Headers.Authorization.ToString();
        if (!header.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase)) return null;
        string token = header[7..].Trim();
        string[] parts = token.Split('.');
        if (parts.Length != 4 || !System.Text.RegularExpressions.Regex.IsMatch(parts[0], "^0x[a-fA-F0-9]{40}$")) return null;
        if (!long.TryParse(parts[1], NumberStyles.None, CultureInfo.InvariantCulture, out long expires) || expires <= DateTimeOffset.UtcNow.ToUnixTimeSeconds()) return null;
        try
        {
            using var hmac = new HMACSHA256(key);
            byte[] expected = hmac.ComputeHash(Encoding.UTF8.GetBytes(string.Join('.', parts[..3])));
            string padded = parts[3].Replace('-', '+').Replace('_', '/').PadRight((parts[3].Length + 3) / 4 * 4, '=');
            byte[] actual = Convert.FromBase64String(padded);
            return CryptographicOperations.FixedTimeEquals(expected, actual) ? parts[0].ToLowerInvariant() : null;
        }
        catch { return null; }
    }
}
