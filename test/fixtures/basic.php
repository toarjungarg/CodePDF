<!DOCTYPE html>
<html>
<body>
<h1 class="title">Pantry page: if else function "quotes" here</h1>
<?php
// A small pantry list. This comment says function and "string" but stays a comment.
# A hash comment with 'quotes' in it.
/* A block comment
   over two lines. */
/** A doc comment for the class below. */

declare(strict_types=1);

namespace App\Pantry;

use App\Shared\Labeled;
use InvalidArgumentException;

const MAX_ITEMS = 1_000;
const MASK = 0xFF;
const FLAGS = 0b1010;
const PERMS = 0o755;
const OLD_PERMS = 0755;
const TINY = 1.5e-3;
const HALF = .5;

#[Attribute(Attribute::TARGET_CLASS)]
final class Shelf
{
    public const LIMIT = 10;

    private array $items = [];

    public function __construct(private string $name = 'main', protected ?int $size = null)
    {
    }

    public function add(Item $item, int ...$more): static
    {
        $this->items[] = $item;
        return $this;
    }

    public function find(string $label): ?Item
    {
        foreach ($this->items as $key => $item) {
            if ($item->label === $label) {
                return $item;
            }
        }
        return NULL;
    }

    public static function make(): Shelf
    {
        return new Shelf('spice', 3);
    }
}

interface Labeled
{
    public function label(): string;
}

abstract class Item implements Labeled, Countable
{
    use Loggable, Sortable;
}

class Spice extends Item
{
    public function label(): string
    {
        return 'It\'s a spice, path C:\\pantry\\spices and \n stays two characters';
    }
}

enum Unit: string
{
    case Cup = 'cup';
    case Gram = 'g';
}

$name = 'Cinnamon';
$$name = 'indirect';
$count = 3;
$price = 4.25;
$plain = 'single $name and {$count} stay plain text';
$greeting = "Hello $name, you have {$count} items and {$shelf->items[0]["x"]} left, cost \$5 and \{$count}.";
$sentence = "Item: $item->label and a stray { brace and \" quote";
$command = `ls -l $name`;

IF ($count > MAX_ITEMS) {
    ECHO "too many";
} ELSEIF ($count === 0) {
    Print 'none';
} else {
    $result = $count <=> 2;
}

$shelf = Shelf::make()->add(new Spice('pepper'));
$found = $shelf?->find('pepper')?->label;
$map = ['a' => 1, 'b' => 2];
$total = (int) $price + 0x1F + 1_000 + 2.5E-3;
$check = $shelf instanceof Shelf && Unit::Cup === Unit::from('cup');
$name = Shelf::class;
$fn = fn(Item $i): string => $i->label();

$text = <<<EOT
Pantry for $name has {$count} items.
She said "hi" and // this is not a comment.
A closing word inside text: EOTX is not the end.
EOT;

$raw = <<<'RAW'
Nowdoc keeps $name and {$count} exactly.
RAW;

$indented = <<<"HTML"
    <p>$name</p>
    HTML;

// The next line ends PHP here ?> and goes back to HTML.
<p>Back in HTML with a "quote" and if inside.</p>
<?= $name ?>
<footer>Total: <?= $count ?> items</footer>
<?php
# This file has no closing tag at the end.
function pantryTotal(array $items): int
{
    return count($items);
}
