#include <stdio.h>
#include <stdlib.h>
#include "list.h"

/* A tiny linked list of temperatures, in plain C. */

#define MAX_READINGS 8
#define ABS(x) _Generic((x), int: abs, double: fabs)(x)

typedef struct node {
    double value;
    struct node *next;
} node_t;

static _Bool is_cold(double celsius) {
    return celsius < 0.0;
}

node_t *push(node_t *head, double value) {
    node_t *new = malloc(sizeof *new); // "new" is just a name in C
    if (new == NULL) {
        return head;
    }
    new->value = value;
    new->next = head;
    return new;
}

void copy(double *restrict out, const double *restrict in, size_t n) {
    for (size_t i = 0; i < n; i++) {
        out[i] = in[i];
    }
}

int main(void) {
    const char *class = "Weather station"; /* a name in C */
    double samples[MAX_READINGS] = {21.5, -3.25, 0x10, 1e-3};
    node_t *list = NULL;

    for (int i = 0; i < 4; i++) {
        list = push(list, samples[i]);
    }

    int cold = 0;
    for (node_t *n = list; n != NULL; n = n->next) {
        cold += is_cold(n->value);
    }
    printf("%s: %d cold reading(s)\n", class, cold);

    while (list != NULL) {
        node_t *next = list->next;
        free(list);
        list = next;
    }
    return 0;
}
