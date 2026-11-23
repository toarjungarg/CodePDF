// A recipe card component. This comment has a <div> that is not a tag.
import { useState } from "react";

export function RecipeCard({ title, steps, ...rest }) {
  const [open, setOpen] = useState(false);
  const ratio = steps.length / 2 / 3;
  const isShort = steps.length < 4 && ratio > 0;

  return (
    <article className="card" data-open={open} {...rest}>
      <h2 onClick={() => setOpen(!open)}>{title} &amp; friends</h2>
      {/* A comment inside JSX */}
      {open && (
        <ol>
          {steps.map((step, i) => (
            <li key={i} title='step'>
              Don't skip step {i + 1}: {step}
            </li>
          ))}
        </ol>
      )}
      <>
        <img src="pancake.png" alt="A stack" />
        <button disabled={isShort}>Cook</button>
      </>
    </article>
  );
}
