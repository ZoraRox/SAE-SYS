-- SPACE FLY (melayang ala luar angkasa) + GUI sederhana
local Players = game:GetService("Players")
local RunService = game:GetService("RunService")
local UIS = game:GetService("UserInputService")
local TweenService = game:GetService("TweenService")

local LP = Players.LocalPlayer
local Camera = workspace.CurrentCamera

-- SETTINGS
local MAX_SPEED = 60    -- kecepatan maksimal
local ACCEL = 1.2       -- makin kecil = makin licin saat mulai bergerak
local DRAG = 0.35       -- makin kecil = makin lama terus meluncur saat berhenti
local BOB_AMOUNT = 1.5  -- naik-turun halus saat mengapung
local TILT = 0.35       -- kemiringan badan saat bergerak

-- STATE
local flying = false
local velocity = Vector3.zero
local conn, bv, bg
local holdUp, holdDown = false, false

-- HAPUS GUI LAMA
local function getGuiParent()
    local ok, ui = pcall(function() return gethui and gethui() end)
    if ok and ui then return ui end
    ok, ui = pcall(function() return game:GetService("CoreGui") end)
    if ok and ui then return ui end
    return LP:WaitForChild("PlayerGui")
end

local GuiParent = getGuiParent()
local old = GuiParent:FindFirstChild("SpaceFlyGui")
if old then old:Destroy() end

-- GUI
local Gui = Instance.new("ScreenGui")
Gui.Name = "SpaceFlyGui"
Gui.ResetOnSpawn = false
Gui.Parent = GuiParent

local Frame = Instance.new("Frame")
Frame.Size = UDim2.new(0, 200, 0, 120)
Frame.Position = UDim2.new(0.5, -100, 0.3, 0)
Frame.BackgroundColor3 = Color3.fromRGB(20, 20, 35)
Frame.BorderSizePixel = 0
Frame.Parent = Gui
Instance.new("UICorner", Frame).CornerRadius = UDim.new(0, 10)

local TitleBar = Instance.new("TextLabel")
TitleBar.Size = UDim2.new(1, 0, 0, 28)
TitleBar.BackgroundColor3 = Color3.fromRGB(35, 35, 60)
TitleBar.BorderSizePixel = 0
TitleBar.Text = "Space Fly"
TitleBar.TextColor3 = Color3.new(1, 1, 1)
TitleBar.Font = Enum.Font.GothamBold
TitleBar.TextSize = 14
TitleBar.Parent = Frame
Instance.new("UICorner", TitleBar).CornerRadius = UDim.new(0, 10)

local FlyBtn = Instance.new("TextButton")
FlyBtn.Size = UDim2.new(1, -20, 0, 36)
FlyBtn.Position = UDim2.new(0, 10, 0, 38)
FlyBtn.BackgroundColor3 = Color3.fromRGB(70, 70, 100)
FlyBtn.Text = "Fly: OFF"
FlyBtn.TextColor3 = Color3.new(1, 1, 1)
FlyBtn.Font = Enum.Font.GothamBold
FlyBtn.TextSize = 15
FlyBtn.AutoButtonColor = true
FlyBtn.Parent = Frame
Instance.new("UICorner", FlyBtn).CornerRadius = UDim.new(0, 8)

local function makeSmallBtn(text, xScale, xOffset)
    local b = Instance.new("TextButton")
    b.Size = UDim2.new(0.5, -15, 0, 30)
    b.Position = UDim2.new(xScale, xOffset, 0, 82)
    b.BackgroundColor3 = Color3.fromRGB(50, 50, 80)
    b.Text = text
    b.TextColor3 = Color3.new(1, 1, 1)
    b.Font = Enum.Font.Gotham
    b.TextSize = 13
    b.Visible = false
    b.Parent = Frame
    Instance.new("UICorner", b).CornerRadius = UDim.new(0, 8)
    return b
end

local UpBtn = makeSmallBtn("Naik", 0, 10)
local DownBtn = makeSmallBtn("Turun", 0.5, 5)

local function bindHold(btn, setter)
    btn.InputBegan:Connect(function(input)
        if input.UserInputType == Enum.UserInputType.MouseButton1 or input.UserInputType == Enum.UserInputType.Touch then
            setter(true)
        end
    end)
    btn.InputEnded:Connect(function(input)
        if input.UserInputType == Enum.UserInputType.MouseButton1 or input.UserInputType == Enum.UserInputType.Touch then
            setter(false)
        end
    end)
end

bindHold(UpBtn, function(v) holdUp = v end)
bindHold(DownBtn, function(v) holdDown = v end)

-- GUI BISA DIGESER
local dragging, dragStart, startPos
TitleBar.InputBegan:Connect(function(input)
    if input.UserInputType == Enum.UserInputType.MouseButton1 or input.UserInputType == Enum.UserInputType.Touch then
        dragging = true
        dragStart = input.Position
        startPos = Frame.Position
        input.Changed:Connect(function()
            if input.UserInputState == Enum.UserInputState.End then dragging = false end
        end)
    end
end)

UIS.InputChanged:Connect(function(input)
    if dragging and (input.UserInputType == Enum.UserInputType.MouseMovement or input.UserInputType == Enum.UserInputType.Touch) then
        local d = input.Position - dragStart
        Frame.Position = UDim2.new(startPos.X.Scale, startPos.X.Offset + d.X, startPos.Y.Scale, startPos.Y.Offset + d.Y)
    end
end)

-- LOGIKA FLY
local function getChar()
    local char = LP.Character
    local hrp = char and char:FindFirstChild("HumanoidRootPart")
    local hum = char and char:FindFirstChildOfClass("Humanoid")
    return hrp, hum
end

local function getDirection(hum, cf)
    local dir = Vector3.zero
    local md = hum.MoveDirection
    if md.Magnitude > 0 then
        local flatLook = Vector3.new(cf.LookVector.X, 0, cf.LookVector.Z)
        if flatLook.Magnitude > 0.01 then
            flatLook = flatLook.Unit
            -- maju/mundur ikut arah pandang kamera (termasuk naik/turun)
            dir = md + Vector3.new(0, cf.LookVector.Y * md:Dot(flatLook), 0)
        else
            dir = md
        end
    end
    if holdUp or UIS:IsKeyDown(Enum.KeyCode.Space) then dir += Vector3.yAxis end
    if holdDown or UIS:IsKeyDown(Enum.KeyCode.LeftShift) or UIS:IsKeyDown(Enum.KeyCode.LeftControl) then dir -= Vector3.yAxis end
    return dir
end

local function stopFly()
    flying = false
    if conn then conn:Disconnect() conn = nil end
    if bv then bv:Destroy() bv = nil end
    if bg then bg:Destroy() bg = nil end
    holdUp, holdDown = false, false

    local hrp, hum = getChar()
    if hrp and hum then
        hum.PlatformStand = false
        local look = Vector3.new(hrp.CFrame.LookVector.X, 0, hrp.CFrame.LookVector.Z)
        if look.Magnitude > 0.01 then
            hrp.CFrame = CFrame.lookAt(hrp.Position, hrp.Position + look)
        end
        hrp.AssemblyAngularVelocity = Vector3.zero
        hum:ChangeState(Enum.HumanoidStateType.GettingUp)
    end

    FlyBtn.Text = "Fly: OFF"
    TweenService:Create(FlyBtn, TweenInfo.new(0.2), { BackgroundColor3 = Color3.fromRGB(70, 70, 100) }):Play()
    UpBtn.Visible = false
    DownBtn.Visible = false
end

local function startFly()
    local hrp, hum = getChar()
    if not hrp or not hum then return end

    flying = true
    velocity = Vector3.zero
    hum.PlatformStand = true

    bv = Instance.new("BodyVelocity")
    bv.MaxForce = Vector3.one * 1e9
    bv.Velocity = Vector3.zero
    bv.Parent = hrp

    bg = Instance.new("BodyGyro")
    bg.MaxTorque = Vector3.one * 1e9
    bg.P = 2500
    bg.D = 400
    bg.CFrame = hrp.CFrame
    bg.Parent = hrp

    FlyBtn.Text = "Fly: ON"
    TweenService:Create(FlyBtn, TweenInfo.new(0.2), { BackgroundColor3 = Color3.fromRGB(60, 160, 100) }):Play()
    UpBtn.Visible = true
    DownBtn.Visible = true

    conn = RunService.Heartbeat:Connect(function(dt)
        local root, humanoid = getChar()
        if not (root and humanoid and bv and bg) then return end

        local cf = Camera.CFrame
        local dir = getDirection(humanoid, cf)
        local moving = dir.Magnitude > 0
        local target = moving and dir.Unit * MAX_SPEED or Vector3.zero
        local rate = moving and ACCEL or DRAG

        -- gerak licin: kecepatan pelan-pelan mendekati target, berhenti pun terus meluncur
        velocity = velocity:Lerp(target, 1 - math.exp(-rate * dt))

        local t = tick()
        local bob = Vector3.new(0, math.sin(t * 0.9) * BOB_AMOUNT, 0)
        bv.Velocity = velocity + bob

        -- orientasi badan: miring ikut arah gerak + goyang pelan seperti zero gravity
        local flatLook = Vector3.new(cf.LookVector.X, 0, cf.LookVector.Z)
        if flatLook.Magnitude < 0.01 then
            flatLook = Vector3.new(root.CFrame.LookVector.X, 0, root.CFrame.LookVector.Z)
        end
        local yaw = CFrame.lookAt(Vector3.zero, flatLook)
        local localVel = yaw:VectorToObjectSpace(velocity)
        local pitch = (localVel.Z / MAX_SPEED) * TILT
        local roll = (-localVel.X / MAX_SPEED) * TILT
        local drift = CFrame.Angles(math.sin(t * 0.5) * 0.12, math.sin(t * 0.3) * 0.25, math.sin(t * 0.7) * 0.18)

        bg.CFrame = yaw * CFrame.Angles(pitch, 0, roll) * drift
    end)
end

local function toggleFly()
    if flying then stopFly() else startFly() end
end

FlyBtn.MouseButton1Click:Connect(toggleFly)

-- TOMBOL F = ON/OFF FLY (PC)
UIS.InputBegan:Connect(function(input, processed)
    if processed then return end
    if input.KeyCode == Enum.KeyCode.F then toggleFly() end
end)

-- RESET SAAT KARAKTER MATI / RESPAWN
LP.CharacterAdded:Connect(function()
    if flying then stopFly() end
end)
