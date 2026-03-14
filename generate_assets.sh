#!/bin/bash

BASE_DIR="/Users/akshit/Downloads/attendance-system-deploy-v3/static/assets/memoji"

mkdir -p "$BASE_DIR"/{skin,hairstyle,brows,eyes,nose,mouth,ears,facial_hair,eyewear,headwear,clothing,head,body}

# Helper function to create SVG
create_svg() {
    local category=$1
    local name=$2
    local content=$3
    printf '%s' "$content" > "$BASE_DIR/$category/$name.svg"
}

# --- SKIN ---
create_svg "skin" "tone_light" '<svg viewBox="0 0 400 400"><ellipse cx="200" cy="200" rx="120" ry="150" fill="currentColor" /></svg>'
create_svg "skin" "tone_medium_light" '<svg viewBox="0 0 400 400"><ellipse cx="200" cy="200" rx="120" ry="150" fill="currentColor" /></svg>'
create_svg "skin" "tone_medium" '<svg viewBox="0 0 400 400"><ellipse cx="200" cy="200" rx="120" ry="150" fill="currentColor" /></svg>'
create_svg "skin" "tone_medium_dark" '<svg viewBox="0 0 400 400"><ellipse cx="200" cy="200" rx="120" ry="150" fill="currentColor" /></svg>'
create_svg "skin" "tone_dark" '<svg viewBox="0 0 400 400"><ellipse cx="200" cy="200" rx="120" ry="150" fill="currentColor" /></svg>'
create_svg "skin" "tone_deep" '<svg viewBox="0 0 400 400"><ellipse cx="200" cy="200" rx="120" ry="150" fill="currentColor" /></svg>'

create_svg "skin" "cheeks_none" '<svg viewBox="0 0 400 400"></svg>'
create_svg "skin" "cheeks_blush" '<svg viewBox="0 0 400 400"><circle cx="130" cy="230" r="20" fill="rgba(255,100,100,0.2)" /><circle cx="270" cy="230" r="20" fill="rgba(255,100,100,0.2)" /></svg>'
create_svg "skin" "cheeks_defined" '<svg viewBox="0 0 400 400"><path d="M110 210 Q120 240 140 250" fill="none" stroke="rgba(0,0,0,0.1)" stroke-width="2"/><path d="M290 210 Q280 240 260 250" fill="none" stroke="rgba(0,0,0,0.1)" stroke-width="2"/></svg>'

create_svg "skin" "spot_none" '<svg viewBox="0 0 400 400"></svg>'
create_svg "skin" "spot_right" '<svg viewBox="0 0 400 400"><circle cx="250" cy="260" r="3" fill="#311f12" /></svg>'
create_svg "skin" "spot_left" '<svg viewBox="0 0 400 400"><circle cx="150" cy="260" r="3" fill="#311f12" /></svg>'
create_svg "skin" "spot_forehead" '<svg viewBox="0 0 400 400"><circle cx="200" cy="120" r="2" fill="#311f12" /></svg>'

# --- HAIRSTYLE ---
# Short
create_svg "hairstyle" "hair_short_1" '<svg viewBox="0 0 400 400"><path d="M100 150 Q200 50 300 150 L305 100 Q200 0 95 100 Z" fill="currentColor" /></svg>'
create_svg "hairstyle" "hair_short_2" '<svg viewBox="0 0 400 400"><path d="M120 150 Q200 70 280 150 L280 120 Q200 40 120 120 Z" fill="currentColor" /></svg>'
create_svg "hairstyle" "hair_short_3" '<svg viewBox="0 0 400 400"><path d="M100 150 Q200 60 300 150 L310 120 Q200 40 90 120 Z" fill="currentColor" /></svg>'
create_svg "hairstyle" "hair_short_4" '<svg viewBox="0 0 400 400"><path d="M110 140 Q200 30 290 140 L295 110 Q200 20 105 110 Z" fill="currentColor" /></svg>'
create_svg "hairstyle" "hair_short_5" '<svg viewBox="0 0 400 400"><path d="M130 150 Q200 90 270 150 L260 110 Q200 50 140 110 Z" fill="currentColor" /></svg>'
# Medium
create_svg "hairstyle" "hair_med_1" '<svg viewBox="0 0 400 400"><path d="M80 150 Q200 20 320 150 L340 250 Q200 200 60 250 Z" fill="currentColor"/></svg>'
create_svg "hairstyle" "hair_med_2" '<svg viewBox="0 0 400 400"><path d="M85 160 Q200 40 315 160 L330 300 Q200 250 70 300 Z" fill="currentColor" /></svg>'
create_svg "hairstyle" "hair_med_3" '<svg viewBox="0 0 400 400"><path d="M90 150 Q200 30 310 150 L320 280 Q200 230 80 280 Z" fill="currentColor" /></svg>'
create_svg "hairstyle" "hair_med_4" '<svg viewBox="0 0 400 400"><path d="M100 160 Q200 50 300 160 L310 320 Q200 280 90 320 Z" fill="currentColor" /></svg>'
# Long
create_svg "hairstyle" "hair_long_1" '<svg viewBox="0 0 400 400"><path d="M70 150 Q200 0 330 150 L350 400 L50 400 Z" fill="currentColor"/></svg>'
create_svg "hairstyle" "hair_long_2" '<svg viewBox="0 0 400 400"><path d="M60 160 Q200 10 340 160 L360 400 L40 400 Z" fill="currentColor"/></svg>'
create_svg "hairstyle" "hair_long_3" '<svg viewBox="0 0 400 400"><path d="M50 170 Q200 20 350 170 L370 400 L30 400 Z" fill="currentColor"/></svg>'
create_svg "hairstyle" "hair_long_4" '<svg viewBox="0 0 400 400"><path d="M40 180 Q200 30 360 180 L380 400 L20 400 Z" fill="currentColor"/></svg>'

# --- BROWS ---
create_svg "brows" "brows_thin" '<svg viewBox="0 0 400 400"><path d="M140 150 L180 145" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M220 145 L260 150" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>'
create_svg "brows" "brows_thick" '<svg viewBox="0 0 400 400"><path d="M130 150 Q160 135 190 150" fill="none" stroke="currentColor" stroke-width="10" stroke-linecap="round" /><path d="M210 150 Q240 135 270 150" fill="none" stroke="currentColor" stroke-width="10" stroke-linecap="round" /></svg>'
create_svg "brows" "brows_curved" '<svg viewBox="0 0 400 400"><path d="M140 150 Q160 140 180 150" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" /><path d="M220 150 Q240 140 260 150" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" /></svg>'
create_svg "brows" "brows_angular" '<svg viewBox="0 0 400 400"><path d="M130 155 L160 145 L190 155" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round"/><path d="M210 155 L240 145 L270 155" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round"/></svg>'
create_svg "brows" "brows_flat" '<svg viewBox="0 0 400 400"><path d="M130 150 L190 150" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round"/><path d="M210 150 L270 150" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round"/></svg>'

# --- EYES ---
create_svg "eyes" "eyes_round" '<svg viewBox="0 0 400 400"><circle cx="160" cy="180" r="15" fill="white" /><circle cx="160" cy="180" r="7" fill="currentColor" /><circle cx="240" cy="180" r="15" fill="white" /><circle cx="240" cy="180" r="7" fill="currentColor" /></svg>'
create_svg "eyes" "eyes_almond" '<svg viewBox="0 0 400 400"><path d="M140 180 Q160 165 180 180 Q160 195 140 180 Z" fill="white" /><circle cx="160" cy="180" r="5" fill="currentColor" /><path d="M220 180 Q240 165 260 180 Q240 195 220 180 Z" fill="white" /><circle cx="240" cy="180" r="5" fill="currentColor" /></svg>'
create_svg "eyes" "eyes_hooded" '<svg viewBox="0 0 400 400"><path d="M140 185 Q160 175 180 185" fill="none" stroke="#000" stroke-width="2"/><circle cx="160" cy="180" r="5" fill="currentColor"/><path d="M220 185 Q240 175 260 185" fill="none" stroke="#000" stroke-width="2"/><circle cx="240" cy="180" r="5" fill="currentColor"/></svg>'
create_svg "eyes" "eyes_droopy" '<svg viewBox="0 0 400 400"><path d="M140 185 Q160 175 180 195" fill="none" stroke="#000" stroke-width="2"/><circle cx="160" cy="180" r="5" fill="currentColor"/><path d="M220 195 Q240 175 260 185" fill="none" stroke="#000" stroke-width="2"/><circle cx="240" cy="180" r="5" fill="currentColor"/></svg>'
create_svg "eyes" "eyes_narrow" '<svg viewBox="0 0 400 400"><path d="M140 180 L180 180" fill="none" stroke="#000" stroke-width="4"/><path d="M220 180 L260 180" fill="none" stroke="#000" stroke-width="4"/></svg>'

# --- HEAD ---
create_svg "head" "head_slim" '<svg viewBox="0 0 400 400"><ellipse cx="200" cy="200" rx="90" ry="150" fill="none" stroke="#555" stroke-width="2"/></svg>'
create_svg "head" "head_round" '<svg viewBox="0 0 400 400"><circle cx="200" cy="200" r="130" fill="none" stroke="#555" stroke-width="2"/></svg>'
create_svg "head" "head_square" '<svg viewBox="0 0 400 400"><rect x="100" y="80" width="200" height="240" rx="40" fill="none" stroke="#555" stroke-width="2"/></svg>'
create_svg "head" "head_oval" '<svg viewBox="0 0 400 400"><ellipse cx="200" cy="200" rx="110" ry="145" fill="none" stroke="#555" stroke-width="2"/></svg>'
create_svg "head" "head_pointed" '<svg viewBox="0 0 400 400"><path d="M100 150 Q200 50 300 150 L250 320 Q200 360 150 320 Z" fill="none" stroke="#555" stroke-width="2"/></svg>'

# --- NOSE ---
create_svg "nose" "nose_small" '<svg viewBox="0 0 400 400"><path d="M195 230 Q200 240 205 230" fill="none" stroke="rgba(0,0,0,0.3)" stroke-width="3" stroke-linecap="round"/></svg>'
create_svg "nose" "nose_medium" '<svg viewBox="0 0 400 400"><path d="M190 230 Q200 250 210 230" fill="none" stroke="rgba(0,0,0,0.2)" stroke-width="4" stroke-linecap="round" /></svg>'
create_svg "nose" "nose_large" '<svg viewBox="0 0 400 400"><path d="M185 230 Q200 260 215 230" fill="none" stroke="rgba(0,0,0,0.3)" stroke-width="5" stroke-linecap="round"/></svg>'
create_svg "nose" "nose_sharp" '<svg viewBox="0 0 400 400"><path d="M195 220 L200 250 L205 220" fill="none" stroke="rgba(0,0,0,0.3)" stroke-width="2"/></svg>'
create_svg "nose" "nose_flat" '<svg viewBox="0 0 400 400"><path d="M180 240 Q200 250 220 240" fill="none" stroke="rgba(0,0,0,0.3)" stroke-width="6" stroke-linecap="round"/></svg>'

# --- MOUTH ---
create_svg "mouth" "mouth_neutral" '<svg viewBox="0 0 400 400"><line x1="170" y1="300" x2="230" y2="300" stroke="currentColor" stroke-width="6" stroke-linecap="round" /></svg>'
create_svg "mouth" "mouth_smile" '<svg viewBox="0 0 400 400"><path d="M160 280 Q200 320 240 280" fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" /></svg>'
create_svg "mouth" "mouth_pout" '<svg viewBox="0 0 400 400"><circle cx="200" cy="300" r="10" fill="none" stroke="currentColor" stroke-width="4"/></svg>'
create_svg "mouth" "mouth_thin" '<svg viewBox="0 0 400 400"><line x1="180" y1="300" x2="220" y2="300" stroke="currentColor" stroke-width="3" stroke-linecap="round" /></svg>'
create_svg "mouth" "mouth_full" '<svg viewBox="0 0 400 400"><path d="M160 300 Q200 330 240 300 Q200 270 160 300 Z" fill="currentColor" fill-opacity="0.2" stroke="currentColor" stroke-width="2"/></svg>'

# --- EARS ---
create_svg "ears" "ears_small" '<svg viewBox="0 0 400 400"><path d="M90 190 Q80 190 85 210 Q90 230 100 220" fill="none" stroke="#555" stroke-width="2"/><path d="M310 190 Q320 190 315 210 Q310 230 300 220" fill="none" stroke="#555" stroke-width="2"/></svg>'
create_svg "ears" "ears_medium" '<svg viewBox="0 0 400 400"><path d="M75 180 Q60 180 65 210 Q70 240 85 230" fill="none" stroke="#555" stroke-width="4"/><path d="M325 180 Q340 180 335 210 Q330 240 315 230" fill="none" stroke="#555" stroke-width="4"/></svg>'
create_svg "ears" "ears_large" '<svg viewBox="0 0 400 400"><path d="M60 170 Q40 170 50 220 Q60 270 90 240" fill="none" stroke="#555" stroke-width="6"/><path d="M340 170 Q360 170 350 220 Q340 270 310 240" fill="none" stroke="#555" stroke-width="6"/></svg>'
create_svg "ears" "ears_pierced" '<svg viewBox="0 0 400 400"><path d="M75 180 Q60 180 65 210 Q70 240 85 230" fill="none" stroke="#555" stroke-width="4"/><circle cx="68" cy="225" r="4" fill="gold"/><path d="M325 180 Q340 180 335 210 Q330 240 315 230" fill="none" stroke="#555" stroke-width="4"/><circle cx="332" cy="225" r="4" fill="gold"/></svg>'

# --- FACIAL HAIR ---
create_svg "facial_hair" "beard_none" '<svg viewBox="0 0 400 400"></svg>'
create_svg "facial_hair" "beard_light" '<svg viewBox="0 0 400 400"><path d="M120 250 Q200 320 280 250 L270 280 Q200 340 130 280 Z" fill="currentColor" opacity="0.4"/></svg>'
create_svg "facial_hair" "beard_heavy" '<svg viewBox="0 0 400 400"><path d="M110 240 Q200 350 290 240 L280 280 Q200 360 120 280 Z" fill="currentColor"/></svg>'
create_svg "facial_hair" "beard_goatee" '<svg viewBox="0 0 400 400"><path d="M170 320 Q200 350 230 320" fill="none" stroke="currentColor" stroke-width="15" stroke-linecap="round"/></svg>'
create_svg "facial_hair" "beard_mustache" '<svg viewBox="0 0 400 400"><path d="M160 270 Q200 260 240 270" fill="none" stroke="currentColor" stroke-width="12" stroke-linecap="round"/></svg>'

# --- EYEWEAR ---
create_svg "eyewear" "glass_none" '<svg viewBox="0 0 400 400"></svg>'
create_svg "eyewear" "glass_round" '<svg viewBox="0 0 400 400"><circle cx="150" cy="180" r="30" fill="none" stroke="currentColor" stroke-width="4"/><circle cx="250" cy="180" r="30" fill="none" stroke="currentColor" stroke-width="4"/><line x1="180" y1="180" x2="220" y2="180" stroke="currentColor" stroke-width="4"/></svg>'
create_svg "eyewear" "glass_square" '<svg viewBox="0 0 400 400"><rect x="120" y="160" width="60" height="40" fill="none" stroke="currentColor" stroke-width="4" /><rect x="220" y="160" width="60" height="40" fill="none" stroke="currentColor" stroke-width="4" /><line x1="180" y1="180" x2="220" y2="180" stroke="currentColor" stroke-width="4" /></svg>'
create_svg "eyewear" "glass_rect" '<svg viewBox="0 0 400 400"><rect x="110" y="165" width="80" height="30" fill="none" stroke="currentColor" stroke-width="4" /><rect x="210" y="165" width="80" height="30" fill="none" stroke="currentColor" stroke-width="4" /><line x1="190" y1="180" x2="210" y2="180" stroke="currentColor" stroke-width="4" /></svg>'
create_svg "eyewear" "glass_aviator" '<svg viewBox="0 0 400 400"><path d="M110 160 L190 160 L180 210 L120 210 Z" fill="none" stroke="currentColor" stroke-width="4"/><path d="M210 160 L290 160 L280 210 L220 210 Z" fill="none" stroke="currentColor" stroke-width="4"/><line x1="190" y1="170" x2="210" y2="170" stroke="currentColor" stroke-width="4"/></svg>'

# --- HEADWEAR ---
create_svg "headwear" "hat_none" '<svg viewBox="0 0 400 400"></svg>'
create_svg "headwear" "hat_cap" '<svg viewBox="0 0 400 400"><path d="M100 130 Q200 60 300 130 L350 150 L350 170 L50 170 L50 150 Z" fill="currentColor" /></svg>'
create_svg "headwear" "hat_beanie" '<svg viewBox="0 0 400 400"><path d="M120 150 Q200 50 280 150 L290 170 Q200 160 110 170 Z" fill="currentColor" /></svg>'
create_svg "headwear" "hat_fedora" '<svg viewBox="0 0 400 400"><path d="M100 150 L300 150 L300 120 Q200 100 100 120 Z" fill="currentColor" /><rect x="50" y="150" width="300" height="10" rx="5" fill="currentColor"/></svg>'
create_svg "headwear" "hat_beret" '<svg viewBox="0 0 400 400"><ellipse cx="200" cy="120" rx="100" ry="30" fill="currentColor" /></svg>'

# --- CLOTHING ---
create_svg "clothing" "cloth_tshirt" '<svg viewBox="0 0 400 400"><path d="M100 350 Q200 320 300 350 L350 400 L50 400 Z" fill="currentColor" /></svg>'
create_svg "clothing" "cloth_shirt" '<svg viewBox="0 0 400 400"><path d="M100 350 L150 350 L200 380 L250 350 L300 350 L330 400 L70 400 Z" fill="currentColor" /><line x1="200" y1="380" x2="200" y2="400" stroke="rgba(0,0,0,0.2)" stroke-width="2" /></svg>'
create_svg "clothing" "cloth_hoodie" '<svg viewBox="0 0 400 400"><path d="M100 350 Q200 330 300 350 L340 400 L60 400 Z" fill="currentColor"/><path d="M150 330 Q200 300 250 330" fill="none" stroke="rgba(0,0,0,0.2)" stroke-width="10" stroke-linecap="round"/></svg>'
create_svg "clothing" "cloth_suit" '<svg viewBox="0 0 400 400"><path d="M100 350 L200 380 L300 350 L340 400 L60 400 Z" fill="currentColor"/><path d="M200 380 L180 400 L220 400 Z" fill="white" opacity="0.3"/></svg>'
create_svg "clothing" "cloth_dress" '<svg viewBox="0 0 400 400"><path d="M120 350 Q200 330 280 350 L320 400 L80 400 Z" fill="currentColor"/></svg>'

# --- BODY ---
create_svg "body" "body_slim" '<svg viewBox="0 0 400 400"><path d="M140 350 Q200 330 260 350 L290 400 L110 400 Z" fill="currentColor" opacity="0.2"/></svg>'
create_svg "body" "body_standard" '<svg viewBox="0 0 400 400"><path d="M120 350 Q200 320 280 350 L330 400 L70 400 Z" fill="currentColor" opacity="0.3" /></svg>'
create_svg "body" "body_athletic" '<svg viewBox="0 0 400 400"><path d="M100 350 Q200 310 300 350 L350 400 L50 400 Z" fill="currentColor" opacity="0.2"/></svg>'
create_svg "body" "body_heavy" '<svg viewBox="0 0 400 400"><path d="M100 350 Q200 300 300 350 L350 400 L50 400 Z" fill="currentColor" opacity="0.1"/></svg>'

echo "Assets generated successfully!"
