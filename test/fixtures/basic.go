// A small recipe shelf. This comment says func and "string" but stays a comment.
package shelf

import (
	"fmt"
	"strings"
)

/* A block comment with a "quote" and 'rune' inside.
   It does not nest: /* this is still the same comment */

const MaxItems = 1_000
const Mask = 0xFF
const Flags = 0b1010
const Perms = 0o755
const Old = 0755
const Tiny = 1.5e-3
const Half = 0x1p-2
const Spin = 3i
const Wave = 1.5i

type Unit int

const (
	Cup Unit = iota
	Spoon
	Gram
)

type (
	Portion struct {
		Name  string
		Grams float64
	}
	Dish interface {
		Describe() string
	}
)

type Shelf struct {
	items map[string][]Portion
	tags  []string
	done  chan struct{}
}

func NewShelf() *Shelf {
	return &Shelf{items: make(map[string][]Portion), done: make(chan struct{})}
}

func (s *Shelf) Add(name string, p Portion) error {
	if name == "" {
		return fmt.Errorf("empty name %q", name)
	}
	s.items[name] = append(s.items[name], p)
	return nil
}

func (p Portion) Describe() string {
	return fmt.Sprintf("%s: %.1f g", p.Name, p.Grams)
}

func total(ps []Portion) (sum float64) {
	for _, p := range ps {
		sum += p.Grams / 2
	}
	return sum
}

func main() {
	quote := '\''
	tab := '\t'
	hex := '\x41'
	accent := 'é'
	path := "C:\\recipes\\\"pancakes\""
	raw := `C:\recipes\pancakes`
	story := `a raw string
that spans three lines, with a "quote" and // not a comment
and a backslash \n that is not an escape`
	ratio := 10 / 4
	ratio /= 2 // division is not a comment
	mask := 0xF0 &^ 0x30
	mask &^= 0x10
	max := 3
	ch := make(chan int, 1)
	ch <- max
	v, ok := <-ch
	var ptr *Portion = nil
	fmt.Println(quote, tab, hex, accent, path, raw, story, ratio, mask, v, ok, ptr, len(path), min(1, 2))
	defer close(ch)
	switch {
	case ok && v > 0:
		fmt.Println(strings.ToUpper("done"))
		fallthrough
	default:
		panic("unreachable")
	}
}
