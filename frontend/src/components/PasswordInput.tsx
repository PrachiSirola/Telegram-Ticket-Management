import { useState } from "react";
import { IconEye, IconEyeOff } from "./Icons";

type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> & {
  wrapperClassName?: string;
};

export function PasswordInput({ wrapperClassName, className, ...props }: Props) {
  const [show, setShow] = useState(false);

  return (
    <div className={`relative ${wrapperClassName ?? ""}`}>
      <input
        {...props}
        type={show ? "text" : "password"}
        className={`input pr-11 ${className ?? ""}`}
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setShow((s) => !s)}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted transition-colors hover:text-fg-soft"
        aria-label={show ? "Hide password" : "Show password"}
      >
        {show ? <IconEyeOff size={18} /> : <IconEye size={18} />}
      </button>
    </div>
  );
}