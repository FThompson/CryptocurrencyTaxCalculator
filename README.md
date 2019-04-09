# Cryptocurrency Mining Tax Income Calculator

This node.js script fetches all "in" transactions for given Bitcoin/Litecoin/Ethereum addresses and the price of each currency at the time of receiving it in order to determine cost basis. Each such transaction constitutes an income event and should be reported on taxes accordingly. Output is a CSV formatted table of all "in" transactions and should be filtered and summed in order to determine income for a year.

## Usage

Place desired addresses into a file named `config.json`. Create an [Etherscan API key](https://etherscan.io/apis) and add that info `config.json` as well.

See `config.example.json` for a template:
```json
{
    "addresses": {
        "bitcoin": [
            
        ],
        "litecoin": [

        ],
        "ethereum": [

        ]
    },
    "apiKeys": {
        "etherscan": ""
    }
}
```

Run by executing `node income-calc.js` and view output on the command line.

## TODO

* Build web front end
* Cache cryptocurrency price data
* Add to/from addresses to Transaction
* Implement additional cryptocurrencies and price services.