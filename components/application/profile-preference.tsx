"use client";

import { Check, Sparkles } from "lucide-react";
import { useState } from "react";

const options = {
  favoriteGenres: ["Action", "Romance", "Fantasy", "Sci-Fi", "Horror", "Comedy"],
  favoriteTypes: ["Movie", "Anime", "Series"],
  favoriteMoods: ["Dark", "Emotional", "Funny", "Relaxing"],
};

export type PreferenceValue = {
  username: string;
  favoriteGenres: string[];
  favoriteTypes: string[];
  favoriteMoods: string[];
};

export function ProfilePreference({
  initial,
  onSaved,
}: {
  initial?: Partial<PreferenceValue>;
  onSaved?: (value: PreferenceValue) => void;
}) {
  const [value, setValue] = useState<PreferenceValue>({
    username: initial?.username ?? "",
    favoriteGenres: initial?.favoriteGenres ?? [],
    favoriteTypes: initial?.favoriteTypes ?? [],
    favoriteMoods: initial?.favoriteMoods ?? [],
  });
  const [status, setStatus] = useState("");
  const toggle = (key: keyof typeof options, item: string) => {
    setValue((current) => ({
      ...current,
      [key]: current[key].includes(item)
        ? current[key].filter((entry) => entry !== item)
        : [...current[key], item],
    }));
  };
  const save = async () => {
    setStatus("Saving…");
    const response = await fetch("/api/user/profile", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...value, onboardingCompleted: true }),
    });
    setStatus(response.ok ? "Preferences saved" : "Sign in to save preferences");
    if (response.ok) onSaved?.(value);
  };

  return (
    <section className="preference-editor">
      <span className="section-kicker"><Sparkles size={13} /> TASTE CALIBRATION</span>
      <h2>Shape your recommendation universe</h2>
      <label>Display name<input value={value.username} onChange={(event) => setValue({ ...value, username: event.target.value })} placeholder="Your name" /></label>
      {(Object.keys(options) as Array<keyof typeof options>).map((key) => (
        <fieldset key={key}>
          <legend>{key === "favoriteGenres" ? "Favorite genres" : key === "favoriteTypes" ? "Favorite content" : "Favorite moods"}</legend>
          <div className="preference-options">
            {options[key].map((item) => (
              <button type="button" key={item} className={value[key].includes(item) ? "selected" : ""} onClick={() => toggle(key, item)}>
                {value[key].includes(item) && <Check size={13} />}{item}
              </button>
            ))}
          </div>
        </fieldset>
      ))}
      <div className="preference-actions"><button className="primary-action" onClick={save}>Save my taste</button><span>{status}</span></div>
    </section>
  );
}
