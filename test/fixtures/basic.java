package kitchen.recipes;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * A small recipe book. This Javadoc says class and "String" but stays a comment.
 */
public class Kitchen {
    private static final int MAX_ITEMS = 1_000;
    private static final int MASK = 0xFF;
    private static final int FLAGS = 0b1010;
    private static final long BIG = 10L;
    private static final double TINY = 1e-3;
    private static final float HALF = 2.5f;

    /* A block comment with a "quote" and 'char' inside */
    public sealed interface Dish permits Soup, Cake {}

    public record Soup(String name, int cups) implements Dish {}

    public non-sealed class Cake implements Dish {
        @Override
        public String toString() {
            return "Cake";
        }
    }

    public enum Unit { CUP, SPOON, GRAM }

    @SuppressWarnings("unchecked")
    @java.lang.Deprecated
    public static <T extends Comparable<T>> T biggest(List<T> items) {
        T best = items.get(0);
        for (T item : items) {
            if (item.compareTo(best) > 0) {
                best = item;
            }
        }
        return best;
    }

    static String describe(Dish dish) {
        return switch (dish) {
            case Soup s when s.cups() > 4 -> "a big soup";
            case Soup s -> "a soup";
            default -> {
                String label = "something else";
                yield label;
            }
        };
    }

    public static void main(String[] args) {
        var pantry = new ArrayList<String>();
        pantry.add("flour");
        int var = 3;
        char quote = '\'';
        char tab = '\t';
        String path = "C:\\recipes\\pancakes";
        String card = """
            Pancakes
              Mix "two cups" of flour.
              A tricky line: \"""
            """;
        Map<String, Integer> counts = Map.of("eggs", 2);
        pantry.forEach(System.out::println);
        Runnable bell = () -> System.out.println("Ding " + var + quote + tab);
        bell.run();
        if (pantry.size() < MAX_ITEMS && counts instanceof Map<?, ?> m) {
            System.out.println(path + card + m + MASK + FLAGS + BIG + TINY + HALF + .5);
        }
    }
}
