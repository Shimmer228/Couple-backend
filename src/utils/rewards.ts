import { PrismaClient, Prisma } from "@prisma/client";

const DEFAULT_REWARDS = [
  {
    title: "Choose movie night",
    description: "Pick the movie and own the remote for the evening.",
    cost: 50,
    minStreak: 0,
    isActive: true,
  },
  {
    title: "Partner orders food",
    description: "Your partner handles dinner ordering for the next meal.",
    cost: 80,
    minStreak: 0,
    isActive: true,
  },
  {
    title: "Yes day",
    description: "Your partner says yes to your plan for one day.",
    cost: 120,
    minStreak: 1,
    isActive: true,
  },
  {
    title: "Golden crown effect",
    description: "Claim the crown and flex your current winning streak.",
    cost: 200,
    minStreak: 3,
    isActive: true,
  },
] satisfies Prisma.RewardCreateManyInput[];

type RewardClient = Pick<PrismaClient, "reward"> | Prisma.TransactionClient;

export const ensureDefaultRewards = async (client: RewardClient) => {
  const existingRewards = await client.reward.findMany({
    where: {
      title: {
        in: DEFAULT_REWARDS.map((reward) => reward.title),
      },
    },
    select: {
      title: true,
    },
  });

  const existingTitles = new Set(existingRewards.map((reward) => reward.title));
  const missingRewards = DEFAULT_REWARDS.filter((reward) => !existingTitles.has(reward.title));

  if (missingRewards.length === 0) {
    return;
  }

  await client.reward.createMany({
    data: missingRewards,
  });
};
