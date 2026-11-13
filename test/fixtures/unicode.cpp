// Unicode test: café, naïve, π ≈ 3.14159, x → y, ✓ done
// 中文注释 (Chinese), 日本語のコメント (Japanese), 한국어 주석 (Korean)
// Combining accent: café, Greek: αβγδ, Cyrillic: Привет
// Emoji (not supported, should not crash): 😀
#include <string>

std::string label = "Ünïcödé → 中文";

int main() {
	return label.size() > 0 ? 0 : 1;
}
