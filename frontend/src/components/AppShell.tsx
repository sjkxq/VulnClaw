import type { ReactNode } from "react";
import type { TaskEvent, TaskRecord } from "../types/api";
import { ActiveTaskBanner } from "./ActiveTaskBanner";
import { Sidebar, type NavItem } from "./Sidebar";
import { Topbar } from "./Topbar";

interface ViewMeta {
  eyebrow: string;
  title: string;
  copy: string;
}

interface AppShellProps<T extends string> {
  activeView: T;
  nav: NavItem<T>[];
  meta: ViewMeta;
  selectedTarget: string | null;
  activeTask: TaskRecord | null;
  latestEvent: TaskEvent | null;
  onSelectView: (view: T) => void;
  onOpenBoundary: () => void;
  onOpenTarget: (target: string) => void;
  onStopTask: () => void;
  children: ReactNode;
}

export function AppShell<T extends string>({
  activeView,
  nav,
  meta,
  selectedTarget,
  activeTask,
  latestEvent,
  onSelectView,
  onOpenBoundary,
  onOpenTarget,
  onStopTask,
  children,
}: AppShellProps<T>) {
  return (
    <div className="app-shell">
      <Sidebar activeView={activeView} nav={nav} onSelectView={onSelectView} />
      <main className="workspace">
        <Topbar
          eyebrow={meta.eyebrow}
          title={meta.title}
          copy={meta.copy}
          selectedTarget={selectedTarget}
          activeTaskStatus={activeTask?.status}
        />
        <ActiveTaskBanner
          task={activeTask}
          latestEvent={latestEvent}
          onOpenBoundary={onOpenBoundary}
          onOpenTarget={onOpenTarget}
          onStop={onStopTask}
        />
        <div className="view-mount">{children}</div>
      </main>
    </div>
  );
}
