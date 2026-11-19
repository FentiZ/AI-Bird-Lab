using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;
using Xunit;

public class AuthTokensTests
{
    private const string Wallet = "0x0123456789abcdef0123456789abcdef01234567";
    private static AuthTokens Auth(string key = "test-key-should-be-longer-than-thirty-two-chars") =>
        new(new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string,string?> { ["Auth:Key"] = key }).Build());

    private static HttpRequest Request(string token)
    {
        var context = new DefaultHttpContext();
        context.Request.Headers.Authorization = "Bearer " + token;
        return context.Request;
    }

    [Fact]
    public void IssuesAndVerifiesToken() => Assert.Equal(Wallet, Auth().Wallet(Request(Auth().Issue(Wallet))));

    [Fact]
    public void DoesNotAcceptTampering()
    {
        var token = Auth().Issue(Wallet);
        Assert.Null(Auth().Wallet(Request(token.Replace(Wallet, "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"))));
        Assert.Null(Auth("another-secret-longer-than-thirty-two-characters").Wallet(Request(token)));
        Assert.Null(Auth().Wallet(Request("bad-token")));
    }

    [Fact]
    public void RejectsExpiredSignedToken()
    {
        const string secret = "test-key-should-be-longer-than-thirty-two-chars";
        string body = Wallet + ".1.random";
        using var mac = new HMACSHA256(Encoding.UTF8.GetBytes(secret));
        var signature = Convert.ToBase64String(mac.ComputeHash(Encoding.UTF8.GetBytes(body)))
            .TrimEnd('=').Replace('+', '-').Replace('/', '_');
        Assert.Null(Auth().Wallet(Request(body + "." + signature)));
    }

    [Fact]
    public void RequiresStrongKey() => Assert.Throws<Exception>(() => Auth("too-short"));
}
