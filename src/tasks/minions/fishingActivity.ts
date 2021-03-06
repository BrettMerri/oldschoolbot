import { Task, KlasaMessage } from 'klasa';

import { saidYes, noOp, roll } from '../../lib/util';
import { Time } from '../../lib/constants';
import { SkillsEnum } from '../../lib/types';
import { FishingActivityTaskOptions } from '../../lib/types/minions';
import getUsersPerkTier from '../../lib/util/getUsersPerkTier';
import createReadableItemListFromBank from '../../lib/util/createReadableItemListFromTuple';
import Fishing from '../../lib/skills/fishing';
import { channelIsSendable } from '../../lib/util/channelIsSendable';
import itemID from '../../lib/util/itemID';
import bankHasItem from '../../lib/util/bankHasItem';
import { UserSettings } from '../../lib/UserSettings';
import { bankHasAllItemsFromBank } from '../../lib/util/bankHasAllItemsFromBank';

export default class extends Task {
	async run({ fishID, quantity, userID, channelID }: FishingActivityTaskOptions) {
		const user = await this.client.users.fetch(userID);
		const currentLevel = user.skillLevel(SkillsEnum.Fishing);
		const currentAgilityLevel = user.skillLevel(SkillsEnum.Agility);

		const fish = Fishing.Fishes.find(fish => fish.id === fishID);

		if (!fish) return;
		let xpReceived = 0;
		let leapingSturgeon = 0;
		let leapingSalmon = 0;
		let leapingTrout = 0;
		let agilityXpReceived = 0;
		if (fish.name === 'Barbarian fishing') {
			for (let i = 0; i < quantity; i++) {
				if (
					roll(255 / (8 + Math.floor(0.5714 * user.skillLevel(SkillsEnum.Fishing)))) &&
					user.skillLevel(SkillsEnum.Fishing) >= 70 &&
					user.skillLevel(SkillsEnum.Agility) >= 48
				) {
					xpReceived += 80;
					agilityXpReceived += 7;
					leapingSturgeon += 1;
				} else if (
					roll(255 / (16 + Math.floor(0.8616 * user.skillLevel(SkillsEnum.Fishing)))) &&
					user.skillLevel(SkillsEnum.Fishing) >= 58 &&
					user.skillLevel(SkillsEnum.Agility) >= 30
				) {
					xpReceived += 70;
					leapingSalmon += 1;
					agilityXpReceived += 6;
				} else if (
					roll(255 / (32 + Math.floor(1.632 * user.skillLevel(SkillsEnum.Fishing))))
				) {
					xpReceived += 50;
					leapingTrout += 1;
					agilityXpReceived += 5;
				}
			}
		} else {
			xpReceived = quantity * fish.xp;
		}
		let bonusXP = 0;

		// If they have the entire angler outfit, give an extra 0.5% xp bonus
		if (bankHasAllItemsFromBank(user.settings.get(UserSettings.Bank), Fishing.anglerItems)) {
			const amountToAdd = Math.floor(xpReceived * (2.5 / 100));
			xpReceived += amountToAdd;
			bonusXP += amountToAdd;
		} else {
			// For each angler item, check if they have it, give its' XP boost if so.
			for (const [itemID, bonus] of Object.entries(Fishing.anglerItems)) {
				if (bankHasItem(user.settings.get(UserSettings.Bank), parseInt(itemID))) {
					const amountToAdd = Math.floor(xpReceived * (bonus / 100));
					xpReceived += amountToAdd;
					bonusXP += amountToAdd;
				}
			}
		}

		await user.addXP(SkillsEnum.Fishing, xpReceived);
		await user.addXP(SkillsEnum.Agility, agilityXpReceived);

		const newLevel = user.skillLevel(SkillsEnum.Fishing);
		const newAgilityLevel = user.skillLevel(SkillsEnum.Agility);

		let str = `${user}, ${user.minionName} finished fishing ${quantity} ${
			fish.name
		}, you also received ${xpReceived.toLocaleString()} XP. ${
			user.minionName
		} asks if you'd like them to do another of the same trip.`;

		if (newLevel > currentLevel) {
			str += `\n\n${user.minionName}'s Fishing level is now ${newLevel}!`;
		}

		if (fish.id === itemID('Raw karambwanji')) {
			quantity *= 1 + Math.floor(user.skillLevel(SkillsEnum.Fishing) / 5);
		}
		const loot = {
			[fish.id]: quantity
		};

		// Add barbarian fish to loot
		if (fish.name === 'Barbarian fishing') {
			loot[fish.id] = 0;
			loot[itemID('Leaping sturgeon')] = leapingSturgeon;
			loot[itemID('Leaping salmon')] = leapingSalmon;
			loot[itemID('Leaping trout')] = leapingTrout;
		}

		str += `\n\nYou received: ${await createReadableItemListFromBank(this.client, loot)}.`;
		if (fish.name === 'Barbarian fishing') {
			str = `${user}, ${user.minionName} finished fishing ${quantity} ${
				fish.name
			}, you also received ${xpReceived.toLocaleString()} fishing XP and ${agilityXpReceived.toLocaleString()} Agility XP. ${
				user.minionName
			} asks if you'd like them to do another of the same trip.
			\n\nYou received: ${leapingSturgeon}x Leaping sturgeon, ${leapingSalmon}x Leaping salmon, and ${leapingTrout}x Leaping trout.`;
			if (newLevel > currentLevel) {
				str += `\n\n${user.minionName}'s Fishing level is now ${newLevel}!`;
			}
			if (newAgilityLevel > currentAgilityLevel) {
				str += `\n\n${user.minionName}'s Agility level is now ${newAgilityLevel}!`;
			}
		}
		if (bonusXP > 0) {
			str += `\n\n**Bonus XP:** ${bonusXP.toLocaleString()}`;
		}

		// Roll for pet
		if (fish.petChance && roll(fish.petChance - user.skillLevel(SkillsEnum.Fishing) * 25)) {
			loot[itemID('Heron')] = 1;
			str += `\nYou have a funny feeling you're being followed...`;
		}

		// Roll for big fish
		if (fish.bigFish && roll(fish.bigFishRate!)) {
			loot[fish.bigFish] = 1;
		}

		await user.addItemsToBank(loot, true);

		const channel = this.client.channels.get(channelID);
		if (!channelIsSendable(channel)) return;

		this.client.queuePromise(() => {
			channel.send(str);

			channel
				.awaitMessages(mes => mes.author === user && saidYes(mes.content), {
					time: getUsersPerkTier(user) > 1 ? Time.Minute * 10 : Time.Minute * 2,
					max: 1
				})
				.then(messages => {
					const response = messages.first();

					if (response) {
						if (response.author.minionIsBusy) return;

						user.log(`continued trip of ${quantity}x ${fish.name}[${fish.id}]`);

						this.client.commands
							.get('fish')!
							.run(response as KlasaMessage, [quantity, fish.name]);
					}
				})
				.catch(noOp);
		});
	}
}
