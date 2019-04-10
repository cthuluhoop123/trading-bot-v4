require('dotenv').config()

const item = {
    market_hash_name: 'Strange Ambassador'
}
const bptfSearchRegex = /(The\s|Strange\s|Non-Craftable\s)?(Specialized\s|Professional\s)?(Killstreak\s)?/

const prices = require('./prices.json')

const Backpacktf = require('./backpacktf.js')
const backpacktf = new Backpacktf(process.env.BACKPACKTF_KEY, process.env.BACKPACKTF_TOKEN)

const search = Object.assign({
    item: item.market_hash_name.replace(bptfSearchRegex, ''),
    fold: 1,
    steamid: process.env.STEAMID,
    intent: 'buy'
}, prices[item.market_hash_name].filters)

backpacktf.searchClassifieds(search)
    .then(res => {
        console.log(res.buy.listings)
    })