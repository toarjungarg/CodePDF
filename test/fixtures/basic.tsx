// A typed recipe list. The <T> in this comment is not code.
import { useState, type ReactNode } from "react";

interface ListProps<T> {
  items: readonly T[];
  render: (item: T) => ReactNode;
}

const identity = <T,>(value: T): T => value;
const pick = <T extends object>(value: T) => value;

export function RecipeList<T>({ items, render }: ListProps<T>) {
  const [count, setCount] = useState<number>(0);
  const half = count! / 2;
  return (
    <Menu.Group label="Recipes">
      {items.map((item, i) => <li key={i}>{render(identity(item))}</li>)}
      <button onClick={() => setCount(count + 1)} disabled={half > 10}>
        More &gt;
      </button>
      {pick({ shown: count as number }).shown}
    </Menu.Group>
  );
}
