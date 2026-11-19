using System.Text.Json.Serialization;

// The old birds.json is reused; fields below match its JSON keys.
public class Bird
{
    [JsonPropertyName("english_name")] public string EnglishName { get; set; } = "";
    [JsonPropertyName("ukrainian_name")] public string UkrainianName { get; set; } = "";
    [JsonPropertyName("scientific_name")] public string ScientificName { get; set; } = "";
    [JsonPropertyName("family")] public string Family { get; set; } = "";
    [JsonPropertyName("habitat_uk")] public string Habitat { get; set; } = "";
    [JsonPropertyName("distribution_uk")] public string Distribution { get; set; } = "";
    [JsonPropertyName("diet_uk")] public string Diet { get; set; } = "";
    [JsonPropertyName("size_uk")] public string Size { get; set; } = "";
    [JsonPropertyName("conservation")] public string Conservation { get; set; } = "";
    [JsonPropertyName("description_uk")] public string Description { get; set; } = "";
    [JsonPropertyName("interesting_fact_uk")] public string InterestingFact { get; set; } = "";
    [JsonPropertyName("source_url")] public string SourceUrl { get; set; } = "";
}

public class Prediction
{
    public string Species { get; set; } = "";
    public double Confidence { get; set; }
}

public class AiResponse
{
    public bool IsBird { get; set; } = true;
    public double BirdConfidence { get; set; }
    public string PredictedSpecies { get; set; } = "";
    public double Confidence { get; set; }
    public List<Prediction> Top3 { get; set; } = new();
}

public class Analysis
{
    public string Status { get; set; } = "queued";
    public string Error { get; set; } = "";
    public int Id { get; set; }
    public string ImageName { get; set; } = "";
    public string PredictedSpecies { get; set; } = "";
    public double Confidence { get; set; }
    public DateTimeOffset AnalysisDate { get; set; }
    public string Description { get; set; } = "";
    public Bird? BirdInfo { get; set; }
    public List<Prediction> Top3 { get; set; } = new();
}
