const request = require('superagent')
const url = 'https://backpack.tf'

class Backpacktf {
    constructor(key, token) {
        this.key = key
        this.token = token
    }

    iGetCurrencies() {
        return new Promise((resolve, reject) => {
            request
                .get(url + '/api/IGetCurrencies/v1')
                .query({
                    key: this.key
                })
                .then(res => {
                    resolve(res.body)
                })
                .catch(reject)
        })
    }

    searchClassifieds(options) {
        return new Promise((resolve, reject) => {
            request
                .get(url + '/api/classifieds/search/v1')
                .query({
                    key: this.key,
                    ...options
                })
                .then(res => {
                    resolve(res.body)
                })
                .catch(reject)
        })
    }

    createListings(listings) {
        return new Promise((resolve, reject) => {
            request
                .post(url + '/api/classifieds/list/v1')
                .send({
                    token: this.token,
                    listings
                })
                .then(res => {
                    resolve(res.body)
                })
                .catch(reject)
        })
    }

    deleteListings(listings) {
        return new Promise((resolve, reject) => {
            request
                .delete(url + '/api/classifieds/delete/v1')
                .send({
                    token: this.token,
                    listing_ids: listings
                })
                .then(res => {
                    resolve(res.body)
                })
                .catch(reject)
        })
    }

    getListings(options) {
        return new Promise((resolve, reject) => {
            request
                .get(url + '/api/classifieds/listings/v1')
                .query({
                    token: this.token,
                    ...options
                })
                .then(res => {
                    resolve(res.body)
                })
                .catch(reject)
        })
    }

    refreshBackpack() {
        return new Promise((resolve, reject) => {
            request
                .get(url + '/_inventory/' + process.env.STEAMID + '?time=&source=steam')
                .then(res => {
                    resolve(res.body)
                })
                .catch(reject)
        })
    }

    startHeartbeat() {
        return new Promise((resolve, reject) => {
            request
                .post(url + '/api/aux/heartbeat/v1')
                .send({
                    token: this.token,
                    automatic: 'all'
                })
                .then(res => {
                    resolve(res.body)
                })
                .catch(reject)
            this.heartbeatTimeout = setTimeout(this.startHeartbeat.bind(this), 1000 * 91)
        })
    }

    stopHeartbeat() {
        clearTimeout(this.heartbeatTimeout)
    }
}

module.exports = Backpacktf