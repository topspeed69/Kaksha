/**
 * Constants shared by the server and the browser. Keep this module free of
 * server-only imports so client pages can use it without pulling in the
 * database driver.
 */

export const SECRET_MASK = "••••••••";
export const SECRET_CLEAR = "__CLEAR__";
