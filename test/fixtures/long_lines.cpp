#include <string>

int main() {
    std::string message = "This is a deliberately very long string literal that keeps going well past the right edge of a normal printed page, so the exporter has to wrap it onto extra rows instead of cutting it off at the margin like a careless printer would do. MARKER_STRING_END";
    int total = 1 + 2 + 3 + 4 + 5 + 6 + 7 + 8 + 9 + 10 + 11 + 12 + 13 + 14 + 15 + 16 + 17 + 18 + 19 + 20 + 21 + 22 + 23 + 24 + 25 + 26 + 27 + 28 + 29 + 30; // MARKER_SUM_END
    return total > 0 ? 0 : 1;
}
