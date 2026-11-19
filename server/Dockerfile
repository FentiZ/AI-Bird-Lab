FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /source
COPY BirdLab.Api.csproj ./
RUN dotnet restore
COPY . .
RUN dotnet publish BirdLab.Api.csproj -c Release -o /app --no-restore
FROM mcr.microsoft.com/dotnet/aspnet:8.0
WORKDIR /app
COPY --from=build /app .
EXPOSE 5080
ENTRYPOINT ["dotnet", "BirdLab.Api.dll"]
