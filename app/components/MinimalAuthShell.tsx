import Link from "next/link";
import type { ReactNode } from "react";
import { RiftBrandLockup } from "@/components/icons/rift-brand-lockup";
import styles from "./MinimalAuthShell.module.css";

/** A quiet, single-column entry to the product, shared by login and signup. */
export default function MinimalAuthShell({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className={styles.shell} data-auth-surface="minimal">
      <div
        className="rift-native-window-drag-strip"
        data-rift-native-titlebar="auth-window"
        data-tauri-drag-region
      />
      <header className={styles.header} data-auth-window-header>
        <Link href="/" aria-label="RIFT home" className={styles.brand}>
          <RiftBrandLockup decorative markSize={35} textSize={16} gap={10} />
        </Link>
        <Link href="/" className={styles.back}>
          Back home
        </Link>
      </header>
      <main className={styles.main}>
        <div className={styles.form}>{children}</div>
      </main>
      <footer className={styles.footer}>
        <nav aria-label="Legal">
          <Link href="/terms-of-service">Terms</Link>
          <Link href="/privacy-policy">Privacy</Link>
        </nav>
      </footer>
    </div>
  );
}
