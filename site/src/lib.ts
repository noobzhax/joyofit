import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const GITHUB_URL = "https://github.com/dzulfikar08/joyofit";
export const HARGA_URL = "https://joyorogo.com/harga";
export const CLOUDAGNI_URL = "https://cloudagni.my.id";
export const JOYOROGO_URL = "https://joyorogo.com";

/** Sets one attribute on the first element matching [selector] in the document head. */
export function setMeta(selector: string, attr: string, value: string) {
  document.head.querySelector(selector)?.setAttribute(attr, value);
}
