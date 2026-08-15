import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import {
  type ButtonHTMLAttributes,
  forwardRef,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";
import { cn } from "@/shared/lib/utils";

const buttonVariants = cva("btn shadow-none font-medium", {
  variants: {
    variant: {
      primary: "btn-primary",
      accent: "btn-secondary",
      secondary:
        "btn-ghost border-base-300 bg-base-100 hover:border-base-content/25 hover:bg-base-200",
      ghost: "btn-ghost text-base-content/65 hover:text-base-content",
      danger: "btn-error btn-outline",
    },
    size: {
      xs: "btn-xs",
      sm: "btn-sm",
      md: "btn-md",
      iconXs: "btn-xs btn-square",
      icon: "btn-sm btn-square",
      iconMd: "btn-md btn-square",
    },
  },
  defaultVariants: { variant: "secondary", size: "md" },
});

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean };

export function Button({ className, variant, size, asChild, ...props }: ButtonProps) {
  const Component = asChild ? Slot : "button";
  return <Component className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

type IconButtonProps = Omit<ButtonProps, "aria-label" | "size"> & {
  "aria-label": string;
  size?: "xs" | "sm" | "md";
};

export function IconButton({ size = "sm", ...props }: IconButtonProps) {
  const buttonSize = size === "xs" ? "iconXs" : size === "md" ? "iconMd" : "icon";
  return <Button size={buttonSize} {...props} />;
}

const inputVariants = cva(
  "input border-base-300 shadow-none aria-invalid:border-error aria-invalid:outline-error/20",
  {
    variants: {
      size: { xs: "input-xs h-8", sm: "input-sm h-9", md: "h-10" },
      tone: { surface: "bg-base-100", subtle: "bg-base-200" },
    },
    defaultVariants: { size: "sm", tone: "surface" },
  },
);

type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "size"> &
  VariantProps<typeof inputVariants>;

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, size, tone, ...props },
  ref,
) {
  return <input ref={ref} className={cn(inputVariants({ size, tone }), className)} {...props} />;
});

const selectVariants = cva(
  "select border-base-300 shadow-none aria-invalid:border-error aria-invalid:outline-error/20",
  {
    variants: {
      size: { xs: "select-xs h-8", sm: "select-sm h-9", md: "h-10" },
      tone: { surface: "bg-base-100", subtle: "bg-base-200" },
    },
    defaultVariants: { size: "sm", tone: "surface" },
  },
);

type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, "size"> &
  VariantProps<typeof selectVariants>;

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, size, tone, ...props },
  ref,
) {
  return <select ref={ref} className={cn(selectVariants({ size, tone }), className)} {...props} />;
});

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("card border border-base-300 bg-base-100 shadow-xs", className)}
      {...props}
    />
  );
}

const badgeVariants = cva("badge badge-sm gap-1.5 font-semibold", {
  variants: {
    tone: {
      neutral: "badge-ghost border-base-300 text-base-content/65",
      cyan: "badge-primary badge-soft",
      green: "badge-success badge-soft",
      amber: "badge-warning badge-soft",
      red: "badge-error badge-soft",
      violet: "badge-secondary badge-soft",
    },
  },
  defaultVariants: { tone: "neutral" },
});

export function Badge({
  children,
  tone,
  className,
}: {
  children: ReactNode;
  tone?: VariantProps<typeof badgeVariants>["tone"];
  className?: string;
}) {
  return <span className={cn(badgeVariants({ tone }), className)}>{children}</span>;
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("skeleton", className)} />;
}

export function EmptyState({
  icon,
  title,
  body,
}: {
  icon: ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="flex min-h-40 items-center justify-center gap-4 border-y border-base-300 px-6 py-8 text-left">
      <div className="shrink-0 text-base-content/45">{icon}</div>
      <div>
        <p className="font-semibold">{title}</p>
        <p className="mt-1 max-w-lg text-sm leading-6 text-[var(--muted)]">{body}</p>
      </div>
    </div>
  );
}

export function ErrorPanel({
  title = "Unable to load data",
  error,
}: {
  title?: string;
  error: unknown;
}) {
  return (
    <div role="alert" className="alert alert-error alert-soft block rounded-box p-4">
      <p className="font-semibold text-[var(--red)]">{title}</p>
      <details className="mt-2">
        <summary className="cursor-pointer text-xs font-medium text-[var(--muted)]">
          Technical details
        </summary>
        <pre className="mono mt-2 max-h-40 overflow-auto whitespace-pre-wrap text-xs text-[var(--muted)]">
          {error instanceof Error ? error.message : String(error)}
        </pre>
      </details>
    </div>
  );
}
