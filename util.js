module.exports = {
    async sendDeletableMessage(channel, message, author) {
        const sentMessage = await channel.send(message)
        await sentMessage.react('🗑')
        const collector = sentMessage.createReactionCollector((reaction, user) => reaction.emoji.name === '🗑' && !user.bot && user.id === author.id, { time: 1000 * 60 * 10, max: 1 })
        collector.on('end', async collected => {
            if (collected.size) {
                try {
                    await sentMessage.delete()
                } catch (err) { }
                return
            }
            if (sentMessage.guild.me.hasPermission('MANAGE_MESSAGES')) { await sentMessage.clearReactions() }
        })
        return sentMessage
    },
    decache(path) {
        const mod = require.cache[require.resolve(path)]
        delete require.cache[require.resolve(path)]
        const index = mod.parent.children.indexOf(mod)
        if (index !== -1) { mod.parent.children.splice(index, 1) }
    }
}