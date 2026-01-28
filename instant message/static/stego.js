// FORTRESS: Steganography Engine (LSB Method)

function hideTextInImage(imageFile, text) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (event) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                canvas.width = img.width;
                canvas.height = img.height;
                ctx.drawImage(img, 0, 0);

                const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                const data = imgData.data;
                
                // Add a terminator character to know when text ends
                const fullText = text + "|END|"; 
                
                // Convert text to binary
                let binary = "";
                for (let i = 0; i < fullText.length; i++) {
                    binary += fullText[i].charCodeAt(0).toString(2).padStart(8, '0');
                }

                // Embed in Least Significant Bit (LSB)
                if (binary.length > data.length / 4) {
                    alert("Text too long for this image!");
                    return;
                }

                for (let i = 0; i < binary.length; i++) {
                    // Replace last bit of the byte with our text bit
                    // i * 4 ensures we only touch Red channel of each pixel (or spread it out)
                    // Here we just go byte by byte covering R, G, B, A...
                    data[i] = (data[i] & 0xFE) | parseInt(binary[i]);
                }

                ctx.putImageData(imgData, 0, 0);
                resolve(canvas.toDataURL()); // Returns the new "Stegged" image
            };
            img.src = event.target.result;
        };
        reader.readAsDataURL(imageFile);
    });
}

function revealTextFromImage(imageSrc) {
    return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = "Anonymous";
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            canvas.width = img.width;
            canvas.height = img.height;
            ctx.drawImage(img, 0, 0);

            const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
            let binary = "";
            let text = "";
            
            // Extract bits
            for (let i = 0; i < data.length; i++) {
                binary += (data[i] & 1).toString();
            }

            // Convert binary to text
            for (let i = 0; i < binary.length; i += 8) {
                const byte = binary.slice(i, i + 8);
                const char = String.fromCharCode(parseInt(byte, 2));
                text += char;
                
                if (text.endsWith("|END|")) {
                    resolve(text.replace("|END|", ""));
                    return;
                }
            }
            resolve(null); // No hidden message found
        };
        img.src = imageSrc;
    });
}