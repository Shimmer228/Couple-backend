export const parseOptionalDate = (value: unknown) => {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsedDate = new Date(String(value));

  if (Number.isNaN(parsedDate.getTime())) {
    throw new Error("INVALID_DATE");
  }

  return parsedDate;
};

export const parseRequiredDate = (value: unknown) => {
  const parsedDate = parseOptionalDate(value);

  if (!parsedDate) {
    throw new Error("DATE_REQUIRED");
  }

  return parsedDate;
};

export const getDayRange = (dateInput: string) => {
  const normalized = dateInput.trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new Error("INVALID_DATE_QUERY");
  }

  const start = new Date(`${normalized}T00:00:00.000Z`);
  const end = new Date(`${normalized}T23:59:59.999Z`);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error("INVALID_DATE_QUERY");
  }

  return { start, end };
};

export const parseOptionalTime = (value: unknown) => {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const normalized = String(value).trim();

  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(normalized)) {
    throw new Error("INVALID_TIME");
  }

  return normalized;
};

export const createDateForDayAndTime = (dateInput: string, timeInput?: string | null) => {
  const normalized = dateInput.trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new Error("INVALID_DATE_QUERY");
  }

  const time = parseOptionalTime(timeInput) ?? "12:00";
  const date = new Date(`${normalized}T${time}:00.000Z`);

  if (Number.isNaN(date.getTime())) {
    throw new Error("INVALID_DATE_QUERY");
  }

  return date;
};
