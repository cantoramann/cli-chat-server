#!/usr/bin/env node

const express = require('express')
const app = express()
const http = require('http')
const server = http.createServer(app)
const { Server } = require('socket.io')
const io = new Server(server)
const { v4: uuidv4 } = require('uuid')

const queue = []
const roomMap = {}

io.on('connection', (socket) => {
  socket.on('join queue', (data) => {
    // check if the queue is full
    if (queue.length > 50) {
      return socket.emit('queue is full')
    }

    queue.push({
      socket: socket.id,
      user: { username: data.username, bio: data.bio },
    })

    // emit the queue to the socket
    socket.emit('joined the queue successfully')

    // if the queue has 2 people, create a room
    if (queue.length >= 2) {
      // get the first 2 users from the queue

      const user1 = queue.shift()
      const user2 = queue.shift()
      const timeCreated = new Date().getTime()

      // prepare room session data (room name as a string and room details in a map)
      const roomName = `${user1.user.username}-${user2.user.username}-${timeCreated}`
      const roomNameDisplayed = `${user1.user.username} meets ${user2.user.username}!` // a presentable room name for users

      roomMap[roomName] = [
        { socket: user1.socket, data: { username: user1.user.username, bio: user1.user.bio } },
        { socket: user2.socket, data: { username: user2.user.username, bio: user2.user.bio } },
      ]

      // send the session details to the sockets
      ;[user1, user2].forEach((user, index) => {
        io.to(user.socket).emit('new chatroom created', {
          roomDetails: { roomNameDisplayed: roomNameDisplayed, roomName, timeCreated },
          otherUser: index == 0 ? { username: user2.user.username, bio: user2.user.bio } : { username: user1.user.username, bio: user1.user.bio },
        })
      })

      setTimeout(() => {
        console.log(`SESSION TIMEOUT :: room ${roomName} timed out`)
        // send sessionTimeout to the sockets
        ;[user1, user2].forEach((user) => {
          io.to(user.socket).emit('session timeout')
          console.log('sent one request to stop')
        })
        console.log()

        // remove the room
        delete roomMap[roomName]
      }, 180000)
    }
  })

  socket.on('message sent to other user', ({ roomName, message }) => {
    // log the new message for testing purposes

    const room = roomMap[roomName]

    if (room) {
      // send the message to the other user
      const otherUser = room.find((user) => user.socket != socket.id)
      io.to(otherUser.socket).emit('message arrived from other user', message)
    }
  })

  socket.on('user left', () => {
    // check if the user is in a room
    const room = Object.keys(roomMap).find((room) => roomMap[room].find((user) => user.socket == socket.id))

    if (room) {
      // send the other user a message that the user left
      const otherUser = roomMap[room].find((user) => user.socket != socket.id)
      io.to(otherUser.socket).emit('other user left the chat')

      // remove the room
      delete roomMap[room]
    } else {
      // remove the user from the queue
      const index = queue.findIndex((user) => user.socket == socket.id)
      queue.splice(index, 1)
    }
  })

  process.on('SIGTERM', () => {
    handleKill()
  })

  process.on('SIGINT', () => {
    handleKill()
  })
})

server.listen(3000, () => {
  console.log('listening on *:3000')
})

const handleKill = () => {
  // send all sessions a kill
  Object.keys(roomMap).forEach((room) => {
    roomMap[room].forEach((user) => {
      io.to(user.socket).emit('server is shutting down temporarily')
    })
  })

  // send all users in the queue a kill
  queue.forEach((user) => {
    io.to(user.socket).emit('server is shutting down temporarily')
  })

  // close the server
  server.close()
}
