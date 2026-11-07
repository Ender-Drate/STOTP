"use client";

import { useState } from "react";

export function PasswordInput({
  id, name, value, onChange, autoComplete, placeholder, required, autoFocus, maxLength,
}: {
  id: string;
  name?: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
  placeholder?: string;
  required?: boolean;
  autoFocus?: boolean;
  maxLength?: number;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="password-field">
      <input
        id={id}
        name={name}
        className="input password-input"
        type={visible ? "text" : "password"}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete={autoComplete}
        placeholder={placeholder}
        required={required}
        autoFocus={autoFocus}
        maxLength={maxLength}
      />
      <button
        type="button"
        className="password-toggle"
        onClick={() => setVisible((value) => !value)}
        aria-label={visible ? "隐藏密码" : "显示密码"}
        aria-pressed={visible}
      >
        {visible ? "隐藏" : "显示"}
      </button>
    </div>
  );
}
