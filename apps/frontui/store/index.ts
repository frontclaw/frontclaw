import { atom } from "jotai";

// Chat sidebar
export const $sidebarAtom = atom({ open: true });

const $scrolledBefore = atom({convIds: []})
