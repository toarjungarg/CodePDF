-- Made-up schema for a small bookshop. Nothing here is real data.
-- The words SELECT and 'quotes' in this comment are not code.

/* Block comment before the tables.
   It runs over two lines and mentions DROP TABLE books; */

CREATE TABLE authors (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name   VARCHAR(80) NOT NULL,
    born        DATE,
    "pen name"  TEXT DEFAULT 'none',   -- a quoted name with a space
    `region`    CHAR(2)                # MySQL style comment
);

CREATE TABLE IF NOT EXISTS books (
    id          SERIAL PRIMARY KEY,
    title       VARCHAR(200) NOT NULL,
    author_id   INT REFERENCES authors (id) ON DELETE CASCADE,
    price       DECIMAL(6, 2) DEFAULT 12.50,
    rating      REAL CHECK (rating BETWEEN .5 AND 5e0),
    flags       INT DEFAULT 0x1F,
    in_stock    BOOLEAN DEFAULT TRUE,
    added_on    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    [odd name]  TEXT                   -- T-SQL bracket name with -- inside: [a -- b]
);

# A MySQL comment on its own line with the word SELECT in it.

insert into authors (full_name, born, "pen name")
values ('Mira O''Hare', '1971-03-02', 'M.O.'),
       ('Sam -- not a comment', '1980-11-30', NULL);

Insert Into books (title, author_id, price)
Values ('The Quiet Shelf', 1, 9.99),
       ('Notes on /* not a comment */ Tea', 2, 14.00);

SELECT b.title,
       a.full_name AS "Author -- Name",
       COUNT(*) OVER (PARTITION BY a.id) AS books_by_author,
       b.price::numeric * 1.13 AS with_tax,
       a.full_name || ' (' || a.born || ')' AS label
FROM books b
INNER JOIN authors a ON a.id = b.author_id
WHERE b.price <> 0
  AND b.title != 'Draft'
  AND b.id = $1
  AND a.born >= :since
ORDER BY b.price DESC
LIMIT 10 OFFSET 5;

select title from books where in_stock is not null and price between 5 and 20;

UPDATE books SET price = price * 0.9 WHERE rating < 2;

DELETE FROM books WHERE added_on < '2000-01-01';

WITH RECURSIVE counter(n) AS (
    SELECT 1
    UNION ALL
    SELECT n + 1 FROM counter WHERE n < 3
)
SELECT n FROM counter;

CREATE FUNCTION shelf_count(shelf_id INT) RETURNS INT AS $$
BEGIN
    -- the body is a dollar-quoted string, so this is not a comment
    RETURN (SELECT COUNT(*) FROM books WHERE id = shelf_id);
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION greet() RETURNS TEXT AS $body$
    SELECT 'It''s open';
$body$ LANGUAGE sql;

SELECT E'tab\there', N'unicode', X'1F';

SELECT @count, @@ROWCOUNT, #temp_books FROM #temp_books;

/* This block comment is never closed, so it runs to the end of the file.
SELECT * FROM books;
