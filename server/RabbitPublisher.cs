using System.Text;
using RabbitMQ.Client;

public class RabbitPublisher
{
    private readonly IConfiguration config;
    public RabbitPublisher(IConfiguration config) => this.config = config;

    public static byte[] JobMessage(int jobId) => Encoding.UTF8.GetBytes(jobId.ToString(System.Globalization.CultureInfo.InvariantCulture));

    public void Send(int jobId)
    {
        var factory = new ConnectionFactory
        {
            HostName = config["Rabbit:Host"] ?? "localhost",
            UserName = config["Rabbit:Username"] ?? "guest",
            Password = config["Rabbit:Password"] ?? "guest"
        };
        using var connection = factory.CreateConnection();
        using var channel = connection.CreateModel();
        channel.QueueDeclare("bird_jobs", durable: true, exclusive: false, autoDelete: false, arguments: null);
        var properties = channel.CreateBasicProperties();
        properties.Persistent = true;
        channel.BasicPublish(exchange: "", routingKey: "bird_jobs", basicProperties: properties,
            body: JobMessage(jobId));
    }
}
