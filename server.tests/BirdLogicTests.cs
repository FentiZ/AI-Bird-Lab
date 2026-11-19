using System.Text;
using System.Text.Json;
using Xunit;

public class BirdLogicTests
{
    [Theory]
    [InlineData("bird.jpg", true)]
    [InlineData("BIRD.JPEG", true)]
    [InlineData("bird.png", true)]
    [InlineData("bird.gif", false)]
    [InlineData("bird", false)]
    public void ValidatesPhotoExtension(string name, bool expected) =>
        Assert.Equal(expected, BirdLogic.IsAllowedPhoto(name));

    [Fact]
    public void DetectsPhotoSignatures()
    {
        Assert.Equal("image/jpeg", BirdLogic.DetectImageMime(new byte[] { 255, 216, 255, 0 }));
        Assert.Equal("image/png", BirdLogic.DetectImageMime(new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 }));
        Assert.Null(BirdLogic.DetectImageMime(new byte[] { 137, 80, 0 }));
        Assert.Null(BirdLogic.DetectImageMime(Encoding.UTF8.GetBytes("fake jpeg")));
    }

    [Theory]
    [InlineData("12._Barn_Owl", "Barn Owl")]
    [InlineData("European_Robin", "European Robin")]
    [InlineData("House Sparrow", "House Sparrow")]
    public void NormalizesBirdName(string original, string expected) =>
        Assert.Equal(expected, BirdLogic.NormalizeSpecies(original));

    [Fact]
    public void ValidatesAiPredictions()
    {
        var prediction = new AiResponse { PredictedSpecies = "Robin", Confidence = 90,
            Top3 = new() { new Prediction { Species = "Robin", Confidence = 90 } } };
        Assert.True(BirdLogic.ValidPrediction(prediction));
        prediction.Confidence = double.NaN;
        Assert.False(BirdLogic.ValidPrediction(prediction));
        prediction.Confidence = 90;
        prediction.Top3[0].Confidence = -1;
        Assert.False(BirdLogic.ValidPrediction(prediction));
        Assert.False(BirdLogic.ValidPrediction(null));
        Assert.True(BirdLogic.ValidPrediction(new AiResponse {
            IsBird = false, BirdConfidence = 10, PredictedSpecies = "", Top3 = new()
        }));
        Assert.False(BirdLogic.ValidPrediction(new AiResponse {
            IsBird = false, BirdConfidence = -1, PredictedSpecies = "", Top3 = new()
        }));
        Assert.False(BirdLogic.ValidPrediction(new AiResponse {
            IsBird = false, BirdConfidence = 40, PredictedSpecies = "fake bird", Top3 = new()
        }));
        Assert.False(BirdLogic.ValidPrediction(new AiResponse {
            IsBird = false, BirdConfidence = 40, PredictedSpecies = "", Top3 = new() {
                new Prediction { Species = "Robin", Confidence = 50 }
            }
        }));
    }

    [Fact]
    public void RejectsWrongWorkerSecret()
    {
        Assert.True(BirdLogic.IsWorkerKey("correct-secret-long-enough", "correct-secret-long-enough"));
        Assert.False(BirdLogic.IsWorkerKey("wrong-secret-long-enough", "correct-secret-long-enough"));
        Assert.False(BirdLogic.IsWorkerKey("", ""));
        Assert.False(BirdLogic.IsWorkerKey("123", "123"));
    }

    [Fact]
    public void ComputesStatsOnlyForCompletedJobs()
    {
        var rows = new[] {
            new Analysis { Status = "done", PredictedSpecies = "Robin", Confidence = 90 },
            new Analysis { Status = "done", PredictedSpecies = "Robin", Confidence = 70 },
            new Analysis { Status = "done", PredictedSpecies = "Owl", Confidence = 50 },
            new Analysis { Status = "queued", PredictedSpecies = "Robin" },
            new Analysis { Status = "failed", PredictedSpecies = "Owl" }
        };
        var stats = JsonSerializer.SerializeToElement(BirdLogic.CalculateStats(rows));
        Assert.Equal(3, stats.GetProperty("total").GetInt32());
        Assert.Equal(1, stats.GetProperty("queued").GetInt32());
        Assert.Equal("Robin", stats.GetProperty("species")[0].GetProperty("species").GetString());
        Assert.Equal(2, stats.GetProperty("species")[0].GetProperty("count").GetInt32());
        Assert.Equal(90, stats.GetProperty("highest").GetProperty("Confidence").GetDouble());
        Assert.Equal(50, stats.GetProperty("lowest").GetProperty("Confidence").GetDouble());
    }

    [Fact]
    public void ExportsEscapedCsvAndSkipsPendingJobs()
    {
        var csv = Encoding.UTF8.GetString(BirdLogic.ExportCsv(new[] {
            new Analysis { ImageName = "bird,1.jpg", PredictedSpecies = "Robin", Status = "done",
                Description = "Has \"wings\"", Confidence = 81.5, AnalysisDate = DateTimeOffset.UnixEpoch },
            new Analysis { ImageName = "pending.jpg", Status = "queued" }
        }));
        Assert.Contains("\"bird,1.jpg\"", csv);
        Assert.Contains("\"Has \"\"wings\"\"\"", csv);
        Assert.Contains(",81.5,", csv);
        Assert.DoesNotContain("pending.jpg", csv);
    }

    [Fact]
    public void RabbitJobContainsOnlyDecimalJobId() =>
        Assert.Equal("42", Encoding.UTF8.GetString(RabbitPublisher.JobMessage(42)));

    [Fact]
    public void BirdCatalogJsonMapsFields()
    {
        const string json = "{\"english_name\":\"Robin\",\"scientific_name\":\"Erithacus rubecula\"}";
        var bird = JsonSerializer.Deserialize<Bird>(json)!;
        Assert.Equal("Robin", bird.EnglishName);
        Assert.Equal("Erithacus rubecula", bird.ScientificName);
    }
}
