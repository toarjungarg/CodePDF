#include <iostream>
#include <vector>

int sumOf(const std::vector<int>& values) {
    int total = 0;
    for (int value : values) {
        total += value;
    }
    return total;
}

int main() {
    std::vector<int> numbers = {1, 2, 3, 4, 5};
    std::cout << "Sum: " << sumOf(numbers) << std::endl;
    return 0;
}
