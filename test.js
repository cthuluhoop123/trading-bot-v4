// require('dotenv').config()

// const prices = require('./prices.json')

// const Backpacktf = require('./backpacktf.js')
// const backpacktf = new Backpacktf(process.env.BACKPACKTF_KEY, process.env.BACKPACKTF_TOKEN)

// backpacktf.getListings()
//     .then(res => {
//         const { listings } = res
//         const bad = Object.keys(prices).filter(item => {
//             return !listings.map(listing => listing.item.name).includes(item) && prices[item].active && !prices[item].isCurrency
//         })
//         console.log(bad)
//     })

const regex = /^(The\s|Strange\s|Non-Craftable\s|Genuine\s)/

console.log('Strange Genuine Incredible'.replace(regex, ''))