FROM node:18

# Menentukan folder kerja di dalam server
WORKDIR /app

# Mengcopy package.json ke dalam folder kerja
COPY package*.json ./

# Menginstall semua library yang dibutuhkan
RUN npm install

# Mengcopy sisa file bot (index.js, dll)
COPY . .

# Menjalankan bot
CMD ["node", "index.js"]
