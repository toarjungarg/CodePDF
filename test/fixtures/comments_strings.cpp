// Line comment at the top
#include "helpers.h"
#define SQUARE(x) ((x) * (x))

/*
 * A block comment that spans
 * several lines.
 */
const char* greeting = "Hello, \"quoted\" world // not a comment";
const char letter = 'q';
const char quote = '\'';
const auto raw = R"json({"key": "value", "path": "C:\temp"}
second raw line)json";
const wchar_t* wide = L"wide string";
const char8_t* utf8 = u8"utf-8 string";
long long big = 1'000'000;
double ratio = 3.14e-2;
unsigned mask = 0xFFu;

int main() {
    int x = SQUARE(4); /* inline block comment */ return x - 16; // trailing comment
}
