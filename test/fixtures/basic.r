#!/usr/bin/env Rscript
# A small bakery helper. The words function and "quotes" in this comment stay comments.

#' Total weight of some loaves.
#' @param weights a numeric vector, like c(500, 750)
#' @return one number
library(stats)

MAX_LOAVES <- 1000L
mask <- 0x1F
big_mask <- 0x10L
ratio <- 1.5e-3
half <- .5
one <- 1
nine <- 9.
imag <- 2i
count <- NA_integer_
missing_name <- NA_character_
empty <- NULL
limit <- Inf

text <- "She said \"hi\" # not a comment"
single <- 'it\'s warm'
spread <- "a string
that runs over two lines"
path <- r"(C:\bakery\loaves)"
fancy <- R"-(has )" and )- inside)-"
square <- r'[a [nested] "quote"]'
curly <- r"{braces # here}"

.hidden <- 5
my_var.2 <- is.na(.hidden)
`my loaf` <- 3
`if` <- 4

total_weight <- function(weights, extra = 0) {
  if (length(weights) == 0) {
    return(extra)
  } else {
    sum(weights) + extra
  }
}

square_it <- \(x) x^2
doubled <- sapply(1:5, \(n) n * 2)

Loaf <- list(name = "rye", weight = 750)
Loaf$name
Loaf$weight <- 800
stats::sd(c(1, 2, 3))
stats:::var(c(4, 5, 6))

result <- c(1, 2, 3) |> rev() |> head(2)
passed <- 3 %in% c(1, 2, 3)
leftover <- 17 %% 5
whole <- 17 %/% 5
c(1, 2) %o% c(3, 4)
5 -> five
10 ->> ten
counter <<- 1

for (i in seq_len(3)) {
  if (i == 2) next
  if (i > 2) break
  cat("loaf", i, "\n")
}

while (TRUE) {
  break
}

repeat {
  break
}

print(paste0("Total: ", total_weight(c(500, 750))))
