require('dotenv').config()

const decache = require('decache')

const Discord = require('discord.js')
const client = new Discord.Client()

const util = require('./util.js')

const prefix = process.env.PREFIX

const { RichEmbed } = require('discord.js')

const express = require('express')
const app = express()

const SteamTotp = require('steam-totp')

const Backpacktf = require('./backpacktf.js')
const backpacktf = new Backpacktf(process.env.BACKPACKTF_KEY, process.env.BACKPACKTF_TOKEN)

const bodyParser = require('body-parser')
const helmet = require('helmet')

app.use(helmet())
app.use(bodyParser.json())
app.use(bodyParser.urlencoded({ extended: true }))

client.on('ready', async () => {
    console.log(`Logged in as ${client.user.tag}!`)
    console.log(await client.generateInvite())
})

client.on('error', () => console.error(error))

client.login(process.env.TOKEN)

client.on('message', async message => {
    if (!message.content.toLowerCase().startsWith(prefix)) { return }
    const args = message.content.split(' ')
    const command = args.shift().toLowerCase().slice(prefix.length)

    if (command === 'profit') {
        const history = require('./history.json')
        const currencies = await backpacktf.iGetCurrencies()
        const keyPrice = currencies.response.currencies.keys.price.value
        const profit = refToScrap(keyPrice) * history.profit.keys + history.profit.metal
        message.reply(`${scrapToRef(profit)} refs`)
        decache('./history.json')
    }

    if (command === 'auth') {
        try {
            await util.sendDeletableMessage(message.channel, SteamTotp.generateAuthCode(process.env.SHARED_SECRET), message.author)
        } catch (err) { console.error(err) }
    }
})

app.post('/tradeAccepted', async (req, res) => {
    const { id, partner, itemsToGive, itemsToReceive, persona } = req.body

    const truncatedItemsToGive = itemsToGive.reduce(truncater, {})
    const truncatedItemsToReceive = itemsToReceive.reduce(truncater, {})
    const tradePartner = persona.player_name

    try {

        const embed = new RichEmbed()
            .setAuthor(`New trade with ${tradePartner} (${partner})`, undefined, `https://steamcommunity.com/profiles/${partner}`)
            .addField('Gave', stringifyTruncatedObject(truncatedItemsToGive))
            .addField('Received', stringifyTruncatedObject(truncatedItemsToReceive))
            .setColor(0x00ee00)
            .setTimestamp()

        await client.guilds.get('553557830074892299').channels.find(channel => channel.name === 'trade-logs').send({ embed })
        res.sendStatus(200)
    } catch (err) {
        console.error(err)
        res.status(500).send(err)
    }
})


function truncater(accumulator, current) {
    !accumulator[current.market_hash_name]
        ? accumulator[current.market_hash_name] = 1
        : accumulator[current.market_hash_name] = accumulator[current.market_hash_name] + 1
    return accumulator
}

function stringifyTruncatedObject(object) {
    const thing = Object.entries(object).map(([item, amount]) => `${amount}x ${item}`).join('\n') || '*nothing*'
    return thing
}

app.listen(process.env.WEBHOOKPORT, () => console.log('Webhook listening on', process.env.WEBHOOKPORT))

function scrapToRef(scrap) {
    return Math.floor(scrap / 9 * 100) / 100
}

function refToScrap(ref) {
    const wholeRef = Math.trunc(ref)
    return wholeRef * 9 + Math.round((ref - wholeRef) / .11)
}