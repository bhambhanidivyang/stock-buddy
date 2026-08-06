"use client";

type Tab<T extends string> = {
  id: T;
  label: string;
};

type Props<T extends string> = {
  tabs: Tab<T>[];
  active: T;
  onChange: (id: T) => void;
  children: React.ReactNode;
};

export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
  children,
}: Props<T>) {
  return (
    <div>
      <div
        role="tablist"
        aria-label="Main sections"
        className="flex gap-1 overflow-x-auto border-b border-stone-200"
      >
        {tabs.map((tab) => {
          const selected = tab.id === active;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`tab-${tab.id}`}
              aria-selected={selected}
              aria-controls={`panel-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(tab.id)}
              className={[
                "relative shrink-0 px-4 py-2.5 text-sm font-medium transition",
                selected
                  ? "text-teal-900"
                  : "text-stone-500 hover:text-stone-800",
              ].join(" ")}
            >
              {tab.label}
              {selected ? (
                <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-teal-700" />
              ) : null}
            </button>
          );
        })}
      </div>
      <div className="pt-6">{children}</div>
    </div>
  );
}

export function TabPanel({
  id,
  active,
  children,
}: {
  id: string;
  active: string;
  children: React.ReactNode;
}) {
  if (id !== active) return null;
  return (
    <div
      role="tabpanel"
      id={`panel-${id}`}
      aria-labelledby={`tab-${id}`}
    >
      {children}
    </div>
  );
}
