import { REST, Routes, MessageFlags } from "discord.js";

import { config } from "../config/index.js";
import { commandLogger } from "../utils/logger.js";
import { hasAdminRole } from "./adminAuth.js";
import { buildSlashCommands, COMMANDS_BY_NAME } from "./definitions.js";

const slashCommands = buildSlashCommands();

/**
 * Throws without logging: only the caller knows whether a failure is fatal.
 * @param {import('discord.js').Client} bot
 * @throws {Error} If the application ID is unavailable or either REST call fails
 */
export async function registerSlashCommands(bot) {
    const rest = new REST({ version: "10" }).setToken(config.discordToken);

    const applicationId = bot.application?.id || bot.user?.id;
    if (!applicationId) {
        throw new Error("Unable to get application ID - bot may not be fully initialized");
    }

    // Separate from guild commands: stale global ones would show in every guild forever.
    await rest.put(Routes.applicationCommands(applicationId), { body: [] });

    await rest.put(
        Routes.applicationGuildCommands(applicationId, config.discordGuildId),
        { body: slashCommands }
    );
    commandLogger.info(`Successfully registered ${slashCommands.length} guild slash commands`);
}

/**
 * @param {import('discord.js').Interaction} interaction
 * @returns {Promise<any>} - Whatever the routed handler returned; not consumed
 */
export async function handleInteraction(interaction) {
    if (!interaction.isChatInputCommand()) return;

    // inGuild() tests guildId + member, so an uncached guild still counts;
    // interaction.guild would be null there and report it as a DM.
    if (!interaction.inGuild()) {
        return interaction.reply({ content: "This bot is only available in servers.", flags: MessageFlags.Ephemeral });
    }

    const { commandName } = interaction;
    const isAdmin = hasAdminRole(interaction);
    const userId = interaction.user?.id || "unknown";
    const username = interaction.user?.username || "unknown";

    try {
        // Same array Discord was registered from, so every command it can send has a handler.
        const command = COMMANDS_BY_NAME.get(commandName);
        if (!command) {
            await interaction.reply({ content: "Unknown command.", flags: MessageFlags.Ephemeral });
            return;
        }

        // Hiding a command in the picker is not a gate; this is.
        if (command.admin) {
            if (!isAdmin) {
                commandLogger.info({ command: commandName, userId, username }, "Admin command attempt by non-admin user");
                return interaction.reply({ content: "You do not have permission to use this command.", flags: MessageFlags.Ephemeral });
            }
            commandLogger.info({ command: commandName, userId, username }, "Admin command executed");
        }

        return await command.handler(interaction);
    } catch (err) {
        commandLogger.error({ command: commandName, err }, "Error handling slash command");
        const content = "An error occurred while processing your command.";
        // A deferred or replied interaction keeps the ephemerality it was created
        // with, so the flag is only set on a first response.
        const response = interaction.replied || interaction.deferred
            ? interaction.editReply({ content })
            : interaction.reply({ content, flags: MessageFlags.Ephemeral });
        await response.catch(() => {});
    }
}
