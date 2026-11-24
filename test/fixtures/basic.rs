// A recipe scaler. This comment says fn and "String" but is not code.
//! Inner doc comment for the module.
use std::collections::HashMap;
use std::fmt;

/* Block comment /* with a nested one */
   still a comment after the inner close */

/// A doc comment on the struct.
#[derive(Debug, Clone, PartialEq)]
pub struct Ingredient<'a> {
    name: &'a str,
    amount: f32,
    grams: u32,
}

#[allow(dead_code)]
enum Meal {
    Breakfast,
    Lunch = 2,
    Dinner,
}

const VERSION: &'static str = "1.0";
const MAX_ITEMS: usize = 1_000;
const MASK: u8 = 0xFF;

impl<'a> Ingredient<'a> {
    fn new(name: &'a str, amount: f32) -> Self {
        Ingredient { name, amount, grams: 0b1010 }
    }

    fn scaled(&self, ratio: f32) -> Option<f32> {
        if ratio != 0.0 { Some(self.amount * ratio / 2.5f32) } else { None }
    }
}

impl fmt::Display for Ingredient<'_> {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "{} ({}g)", self.name, self.grams)
    }
}

fn main() {
    let quote = '\'';
    let letter = 'a';
    let tab = '\t';
    let emoji = '😀';
    let raw = r#"He said "two cups" and left"#;
    let path = r"C:\recipes\pancakes";
    let bytes = b"flour";
    let r#match = 3;
    let mut totals: HashMap<String, Vec<u32>> = HashMap::new();
    let story = "a string that
spans two lines";

    'outer: for i in 1..10 {
        for j in 0..=i {
            if i * j > 20 {
                break 'outer;
            }
        }
    }

    let items = vec![Ingredient::new("flour", 1.5), Ingredient::new("milk", 2.)];
    totals.insert(String::from("flour"), vec![1, 2, 3]);
    println!("{} {} {} {:?}", quote, letter, tab, emoji);
    println!("{raw} {path} {:?} {} {}", bytes, r#match, story);
    let first = items.first().map(|x| x.amount).unwrap_or(0.0);
    let half = first / 2.0;
    println!("{VERSION} {MAX_ITEMS} {MASK} {half}");
}
