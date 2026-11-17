"use client";

import { useState } from "react";

import { DatePicker, formatDisplay } from "./DatePicker";

// Click-to-edit text/number. Shows plain text until clicked, then an input
// that commits on blur or Enter and cancels on Escape. The idle state carries
// a transparent border and the input's padding so swapping between them does
// not resize the cell. Date fields swap in the full DatePicker instead of a
// bare input, so month/year jumping and typed entry work here too.
export function InlineEdit({
  value,
  onSave,
  display,
  type = "text",
  placeholder,
  align = "left",
  className = "",
}: {
  value: string;
  onSave: (value: string) => void;
  display?: string;
  type?: "text" | "number" | "date" | "email" | "tel";
  placeholder?: string;
  align?: "left" | "right";
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  if (editing && type === "date") {
    return (
      <DatePicker
        autoFocus
        value={draft}
        placeholder={placeholder}
        onChange={setDraft}
        onCommit={(iso) => {
          setEditing(false);
          if (iso !== value) onSave(iso);
        }}
        onCancel={() => {
          setDraft(value);
          setEditing(false);
        }}
        className={`w-44 ${className}`}
      />
    );
  }

  if (editing) {
    return (
      <input
        autoFocus
        type={type}
        min={type === "number" ? 0 : undefined}
        defaultValue={value}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={(e) => {
          setEditing(false);
          if (e.target.value !== value) onSave(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            e.currentTarget.value = value;
            setEditing(false);
          }
        }}
        className={`rounded border border-border bg-background px-1.5 py-0.5 text-sm text-foreground outline-none focus:border-foreground ${
          align === "right" ? "text-right" : ""
        } ${className}`}
      />
    );
  }

  const shown =
    display ?? (type === "date" && value ? formatDisplay(value) : value);
  return (
    <button
      type="button"
      onClick={() => {
        setDraft(value);
        setEditing(true);
      }}
      title="Click to edit"
      className={`whitespace-nowrap rounded border border-transparent px-1.5 py-0.5 text-sm transition-colors hover:bg-muted-bg ${
        align === "right" ? "text-right" : "text-left"
      } ${shown ? "text-foreground" : "text-muted"} ${className}`}
    >
      {shown || placeholder}
    </button>
  );
}

// Click-to-edit dropdown. Reads as plain text until you interact: a subtle
// hover background hints it's editable, a single click opens the native menu,
// and picking an option commits immediately. No boxy control when idle.
export function InlineSelect({
  value,
  options,
  onChange,
  className = "",
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => {
        if (e.target.value !== value) onChange(e.target.value);
      }}
      title="Click to edit"
      className={`max-w-full cursor-pointer appearance-none rounded border border-transparent bg-transparent px-1.5 py-0.5 text-sm text-foreground outline-none transition-colors hover:bg-muted-bg focus:border-border focus:bg-background ${className}`}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
