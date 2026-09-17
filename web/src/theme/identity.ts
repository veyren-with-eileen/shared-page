import type { Author } from "../domain/calendar";

/** Product-facing names for the stable wire/domain author identities. */
export const DISPLAY_NAME: Readonly<Record<Author, string>> = {
  kitty: "Eileen",
  master: "Veyren",
  system: "AUTO"
};
