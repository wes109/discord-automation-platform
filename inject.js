console.log("Starting Content Script..")
sleep(10000)
console.log("====== INITIALIZING ======")


function sleep(ms) {
    console.log("Waiting: " + ms)
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

var lastMessage;
var textMessage;
var embedMessage;
var theMessage;
var lastSentMessageEmbedTitle;
var lastSentMessageEmbedDescription;

function concatenateValues(array) {
    let result = '';
    for (let obj of array) {
        const name = obj.name;
        const value = obj.value;
        if (name != undefined) { result += `\n${name} ${value}`; }
        //   console.log(result + " -----RESULT")
    }
    return result;
}

function sendMessage(botToken, message) {
    try {
        const apiUrl = `https://hook.us1.make.com/${botToken}`;
        var formdata = new FormData();
        console.log(message)
        for (var i = 0; i < message.length; i++) {
            if (message[i].name == undefined) { message[i].name = 'title' }
            formdata.append(message[i].name, message[i].value)
        }
        const response = fetch(apiUrl, {
            method: 'POST',
            body: formdata,
        });

        const data = response.json();
        console.log('Message sent successfully:', data);
    } catch (error) {
        console.error('Error sending message:', error);
    }
}


async function checkStatus() {
    // console.log('checking status')
    var theMessage;
    var allMessages = document.querySelectorAll('li[id*="chat-messages"]')
    var lastMessageContainer = allMessages[allMessages.length - 1];
    var lastMessageEmbedFields = lastMessageContainer.querySelectorAll(
        'div[class*="embedFields"]'
    );
    var lastMessageEmbedFieldsField = lastMessageContainer.querySelectorAll(
        'div[class*="embedFields"] div[class*="embedField"]'
    );
    var lastMessageText = lastMessageContainer.querySelector(
        'div[class*="messageContent"]'
    );
    var lastMessageEmbedTitle = lastMessageContainer.querySelector(
        'div[class*="embedTitle"] a'
    );
    var lastMessageEmbedDescription = lastMessageContainer.querySelector(
        'div[class*="embedDescription"]'
    );
    var lastMessageHeader =
        lastMessageContainer.querySelector('*[class*="header"]');
    var lastMessageFooter = lastMessageContainer.querySelector(
        '*[class*="embedFooter"]'
    );
    var eyesEmoji = lastMessageContainer.querySelector('img[data-name=":eyes:"]');

    function removeUndefinedObjects(array) {
        return array.filter((obj) => obj.value !== undefined && obj.name !== undefined);
    }


    // if (eyesEmoji == undefined && eyesEmoji == null) {
    var telegramArray = []
    telegramArray.push({ name: 'Deployer Tags', value: lastMessageText.textContent })
    if (
        lastMessageEmbedDescription != undefined &&
        lastMessageEmbedDescription != null
    ) {
        if (
            (lastMessageEmbedTitle == undefined) |
            (lastMessageEmbedTitle == null)
        ) {
            lastMessageEmbedTitle = `title came back as null - DM wes if this continues`;
        } else {
            lastMessageEmbedTitle = `${lastMessageEmbedTitle.textContent}\n${lastMessageEmbedTitle.getAttribute('href')}`
            lastMessageEmbedTitle.replaceAll("\n", " ");
        }
        lastMessageEmbedDescription = `${lastMessageEmbedDescription.textContent}`;
        if (lastMessageEmbedDescription != lastSentMessageEmbedDescription) {
            lastSentMessageEmbedDescription = lastMessageEmbedDescription
            telegramArray.push({ name: 'desc', value: lastSentMessageEmbedDescription })
            // sendMessage('6164470357:AAG8IvKkWe-vrmC3-V9BRzpPAjPXP7rX20E', '-983171314', lastMessageEmbedDescription)
        }
        lastMessageEmbedDescription = `${lastMessageEmbedDescription.textContent}`;
        theMessage = `${lastMessageEmbedTitle}-${lastMessageEmbedDescription}`;
        if (lastMessageEmbedTitle != undefined) { telegramArray.push({ name: 'title', value: lastMessageEmbedTitle }) }
        // if(lastMessageEmbedDescription != undefined){telegramArray.push({name: lastMessageEmbedDescription, value: ''})}

    } else {
        lastMessageEmbedDescription =
            "address came back as null - DM wes if this continues";
    }
    var count = 0;
    for (var i = 0; i < lastMessageEmbedFieldsField.length; i++) {
        if (lastMessageEmbedFieldsField[i].querySelector('div[class*="embedField"]') != null) {
            var embedName = lastMessageEmbedFieldsField[i].querySelector('div[class*="embedFieldName"] span')
            var embedValue = lastMessageEmbedFieldsField[i].querySelector('div[class*="embedFieldValue"]')
            var embedEmoji = lastMessageEmbedFieldsField[i].querySelector('div[class*="embedFieldValue"] span[class*="emojiContainer"] img')
            var text = embedName.textContent.trim()
            var embedFundLinks = lastMessageEmbedFieldsField[i].querySelectorAll('div[class*="embedFieldValue"] a[href*="0x"]')
            var embedLinks = lastMessageEmbedFieldsField[i].querySelectorAll('div[class*="embedFieldValue"] a')
            switch (text) {
                case 'Verified':
                    if (embedEmoji != null) { embedValue = `${embedValue.textContent} ${embedEmoji.getAttribute('alt')}` } else { embedValue = `${embedValue.textContent}` }
                    telegramArray.push({ name: embedName.textContent.trim(), value: embedValue.replaceAll('\n', ' ').trim() })
                    break;
                case 'Renounced':
                    if (embedEmoji != null) { embedValue = `${embedValue.textContent} ${embedEmoji.getAttribute('alt')}` } else { embedValue = `${embedValue.textContent}` }
                    telegramArray.push({ name: embedName.textContent.trim(), value: embedValue.replaceAll('\n', ' ').trim() })
                    break;
                case 'AG':
                    if (embedEmoji != null) { embedValue = `${embedValue.textContent} ${embedEmoji.getAttribute('alt')}` } else { embedValue = `${embedValue.textContent}` }
                    telegramArray.push({ name: embedName.textContent.trim(), value: embedValue.replaceAll('\n', ' ').trim() })
                    break;
                case 'Deployer':
                    // if(embedEmoji != null) {
                    //     if(embedEmoji.getAttribute('data-name') == ':red_circle:') {embedValue = `🔴 ${embedLinks[0].getAttribute('href')}`}
                    //     if(embedEmoji.getAttribute('data-name') == ':yellow_circle:') {embedValue = `🟡 ${embedLinks[0].getAttribute('href')}`}
                    //     if(embedEmoji.getAttribute('data-name') == ':green_circle:') {embedValue = `🟢 ${embedLinks[0].getAttribute('href')}`}
                    // } else {
                    //     embedValue = `${embedLinks[0].getAttribute('href')}`
                    // }
                    embedValue = `${embedLinks[0].getAttribute('href')}`
                    telegramArray.push({ name: embedName.textContent.trim(), value: embedValue })
                    break;
                case 'Contract Stats':
                    if (count == 0) {
                        embedValue = embedValue.textContent
                        embedLinks.forEach((link) => embedValue = `${embedValue}\n${link.getAttribute('href')}`);
                        telegramArray.push({ name: embedName.textContent.trim(), value: embedValue })
                        count++
                    } else if (count == 1) {
                        embedValue = embedValue.textContent
                        embedLinks.forEach((link) => embedValue = `${embedValue}/n${link.getAttribute('href')}`);
                        telegramArray.push({ name: `2nd ${embedName.textContent.trim()}`, value: embedValue })
                        count++
                    }
                    break;
                case 'Active since':
                    if (embedEmoji != null) { embedValue = `${embedValue.textContent} ${embedEmoji.getAttribute('alt')}` } else { embedValue = `${embedValue.textContent}` }
                    telegramArray.push({ name: embedName.textContent.trim(), value: embedValue.replaceAll('\n', ' ').trim() })
                    break;
                case 'Funding':
                    embedValue = embedValue.textContent
                    if (embedValue.split('(')[1] != undefined) { embedValue = `${embedFundLinks[0]}\n(${embedValue.split('(')[1]}` }
                    telegramArray.push({ name: '\nFunding/Balance', value: embedValue })
                    break;
                case 'Most Recent Contracts':
                    if (embedEmoji != null) { embedValue = `${embedValue.textContent} ${embedEmoji.getAttribute('alt')}` } else { embedValue = `${embedValue.textContent}` }
                    telegramArray.push({ name: embedName.textContent.trim(), value: embedValue.replaceAll('\n', ' ').trim() })
                    break;
                case 'Socials':
                    embedValue = `${embedValue.textContent}`
                    telegramArray.push({ name: embedName.textContent.trim(), value: embedValue })
                    break;
                case 'Description':
                    if (embedEmoji != null) { embedValue = `${embedValue.textContent} ${embedEmoji.getAttribute('alt')}` } else { embedValue = `${embedValue.textContent}` }
                    telegramArray.push({ name: embedName.textContent.trim(), value: embedValue.replaceAll('\n', ` `).trim() })
                    break;
                case 'Flags':
                    embedValue = `${embedValue.textContent}`
                    telegramArray.push({ name: embedName.textContent.trim(), value: embedValue.replaceAll('\n', ` `).trim() })
                    break;
            }

        }
    }

    theMessage = removeUndefinedObjects(telegramArray)
    // theMessage = concatenateValues(theMessage)
    // } else {console.log('no emoji')}
    // console.log(`theMessage = ${theMessage}`)

    if (lastMessageEmbedTitle == lastMessage) {
        // console.log(`nothing new - Last Message: ${lastMessage} <-`)
        // console.log(`nothing new - theMessage: ${theMessage} <-`)
    } else {
        if (theMessage != null && theMessage != undefined && theMessage != '') {
            lastMessage = lastMessageEmbedTitle
            lastSentMessageEmbedTitle = lastMessageEmbedTitle
            sendMessage('wve829nulib1nybglzi3zfikol4388an', theMessage)
        }
    }
}
window.setInterval(async function () {
    if (window.location.href.includes('discord.com/channels')) {
        checkStatus()
    } else {
        console.log("This ain't a discord channel!")
    }
}, 1000);