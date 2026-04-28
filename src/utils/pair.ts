const JOIN_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const JOIN_CODE_LENGTH = 6;
const MAX_GENERATION_ATTEMPTS = 10;

const randomCharacter = () => {
  const index = Math.floor(Math.random() * JOIN_CODE_ALPHABET.length);
  return JOIN_CODE_ALPHABET[index];
};

const generateJoinCode = () => {
  let code = "";

  for (let index = 0; index < JOIN_CODE_LENGTH; index += 1) {
    code += randomCharacter();
  }

  return code;
};

export const generateUniqueJoinCode = async (
  isTaken: (joinCode: string) => Promise<boolean>
) => {
  for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt += 1) {
    const joinCode = generateJoinCode();
    const taken = await isTaken(joinCode);

    if (!taken) {
      return joinCode;
    }
  }

  throw new Error("Unable to generate a unique join code");
};
