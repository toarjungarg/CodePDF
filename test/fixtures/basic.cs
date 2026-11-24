#nullable enable
global using System.Text;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

namespace Kitchen.Recipes;

/// <summary>
/// A small recipe book. This comment says class and "string" but stays a comment.
/// </summary>
public interface IDish
{
    string Name { get; }
}

public record Soup(string Name, int Cups) : IDish;

public record struct Portion(int Grams);

public enum Unit { Cup, Spoon, Gram }

[Serializable]
[Obsolete("Use Pantry instead")]
public partial class Cookbook : IDish
{
    private const int MaxItems = 1_000;
    private const int Mask = 0xFF;
    private const int Flags = 0b1010;
    private const long Big = 10L;
    private const ulong Huge = 10UL;
    private const double Tiny = 1e-3;
    private const float Half = 2.5f;
    private const decimal Price = 9.99m;

    /* A block comment with a "quote" and 'char' inside */
    public string Name { get; init; } = "Pancakes";
    public int Count { get; private set; }

    private readonly Dictionary<string, int> stock = new()
    {
        ["eggs"] = 2,
    };

#region Helpers
    public static T Biggest<T>(List<T> items) where T : IComparable<T>
    {
        T best = items[0];
        foreach (var item in items)
        {
            if (item.CompareTo(best) > 0)
            {
                best = item;
            }
        }
        return best;
    }
#endregion

    static string Describe(IDish dish) => dish switch
    {
        Soup s when s.Cups > 4 => "a big soup",
        Soup { Cups: > 0 and < 3 } => "a small soup",
        Soup => "a soup",
        _ => "something else",
    };

    public static IEnumerable<int> Steps()
    {
        yield return 1;
        yield break;
    }

    public static async Task Main(string[] args)
    {
        var pantry = new List<string> { "flour", "milk" };
        int var = 3;
        char quote = '\'';
        char tab = '\t';
        string path = @"C:\recipes\pancakes";
        string said = @"She said ""hi""";
        string name = "Pancakes";
        double cups = 1.5;
        string line = $"{name,-10}: {cups:F1} cups, {{not a hole}}";
        string card = $@"Recipe for {name}
in {path}";
        string json = """
            { "dish": "soup" }
            """;
        string raw = $$"""{"name": "{{name}}"}""";
        var bytes = "flour"u8;
        var cheap = from item in pantry
                    where item.Length > 4
                    orderby item
                    select item.ToUpper();
        foreach (var file in pantry)
        {
            Console.WriteLine(file);
        }
        var soup = new Soup("Tomato", 5);
        var bigger = soup with { Cups = 6 };
        if (soup is not null && bigger is { Cups: > 5 })
        {
            Console.WriteLine(nameof(Cookbook) + Describe(soup));
        }
        int[] numbers = [1, 2, 3];
        var middle = numbers[1..3];
        await Task.Delay(1);
        global::System.Console.WriteLine(line + card + json + raw + bytes.Length + said + var + quote + tab);
        int @class = Mask + Flags;
        Console.WriteLine(cheap.Count() + @class + Big + Huge + Tiny + Half + Price + middle.Length + .5);
#if DEBUG
        Console.WriteLine("debug build");
#endif
    }
}
