"use strict";

class ShiftOverrideError extends Error {
  constructor(status, code, message, details = {}) {
    super(message);
    this.name = "ShiftOverrideError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

module.exports = {
  ShiftOverrideError,
};
