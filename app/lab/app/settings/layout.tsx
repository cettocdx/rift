/**
 * Settings inside this shell.
 *
 * A thin host: the sections, the shell and the metadata are the same modules
 * the chat shell renders. What differs is only where they mount — opening
 * settings from the IDE must not throw away the file tree and the terminal, so
 * every shell that can open settings hosts its own copy of the route.
 */
export { default, metadata } from "@/app/(chat)/settings/layout";
