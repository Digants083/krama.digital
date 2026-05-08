import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.mime.application import MIMEApplication
import os
import logging
from typing import Optional
from dotenv import load_dotenv, find_dotenv

# Load environment variables (ensure we pick up backend/.env when running uvicorn)
load_dotenv(find_dotenv())

logger = logging.getLogger(__name__)


class EmailService:
    """Service for sending emails via SMTP"""
    
    def __init__(self):
        self.smtp_host = os.getenv("SMTP_SERVER", "smtp.gmail.com")
        self.smtp_port = int(os.getenv("SMTP_PORT", "587"))
        self.smtp_user = (os.getenv("SMTP_USERNAME", "") or "").strip()
        # Gmail app-passwords are often copied with spaces; remove whitespace.
        self.smtp_password = (os.getenv("SMTP_PASSWORD", "") or "").strip().replace(" ", "")
        self.sender_email = (os.getenv("FROM_EMAIL", self.smtp_user) or "").strip()
        self.sender_name = os.getenv("SENDER_NAME", "Krama Clinic")

        logger.info(f"EmailService initialized: smtp_user={self.smtp_user}, smtp_host={self.smtp_host}, smtp_port={self.smtp_port}")
        
        if not self.smtp_user or not self.smtp_password:
            logger.warning(
                "EmailService SMTP is not fully configured. SMTP_USERNAME or SMTP_PASSWORD missing."
            )
    
    def send_otp_email(self, to_email: str, otp_code: str) -> bool:
        """
        Send OTP verification email
        
        Args:
            to_email: Recipient email address
            otp_code: 6-digit OTP code
            
        Returns:
            bool: True if email sent successfully, False otherwise
        """
        subject = "Your OTP Verification Code"
        
        # HTML email content
        html_content = f"""
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body {{ font-family: Arial, sans-serif; line-height: 1.6; color: #333; }}
                .container {{ max-width: 600px; margin: 0 auto; padding: 20px; }}
                .otp-box {{ background: #f4f4f4; padding: 20px; text-align: center; border-radius: 8px; margin: 20px 0; }}
                .otp-code {{ font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #00555A; }}
                .footer {{ font-size: 12px; color: #888; text-align: center; margin-top: 20px; }}
            </style>
        </head>
        <body>
            <div class="container">
                <h2>OTP Verification</h2>
                <p>Your OTP verification code is:</p>
                <div class="otp-box">
                    <div class="otp-code">{otp_code}</div>
                </div>
                <p>This code expires in <strong>5 minutes</strong>.</p>
                <p>If you didn't request this code, please ignore this email.</p>
                <div class="footer">
                    <p>© 2024 Krama Clinic. All rights reserved.</p>
                </div>
            </div>
        </body>
        </html>
        """
        
        # Plain text fallback
        text_content = f"""
        Your OTP Verification Code
        ==========================
        
        Your OTP is: {otp_code}
        
        This code expires in 5 minutes.
        
        If you didn't request this code, please ignore this email.
        
        © 2024 Krama Clinic
        """
        
        return self._send_email(to_email, subject, text_content, html_content)

    def send_queue_alert_email(
        self,
        to_email: str,
        patient_name: str,
        clinic_name: str,
        alert_type: str,
        token_number: Optional[str] = None,
        doctor_name: Optional[str] = None,
        clinic_location: Optional[str] = None,
        latitude: Optional[str] = None,
        longitude: Optional[str] = None,
    ) -> bool:
        """Send queue progress alerts for patients nearing their turn."""
        safe_name = patient_name or "Patient"
        safe_clinic = clinic_name or "the clinic"
        safe_token = token_number or "TBD"
        safe_doctor = doctor_name or "Assigned Doctor"

        # Generate Google Maps link if coordinates are available
        if latitude and longitude:
            google_maps_url = f"https://maps.google.com/?q={latitude},{longitude}"
            safe_location = f'<a href="{google_maps_url}" style="color: #00555A; text-decoration: none; font-weight: bold;">Click for directions to {safe_clinic}</a>'
        else:
            safe_location = clinic_location or "Location will be shared at clinic desk"

        if alert_type == "reach_turn":
            subject = f"It's your turn soon at {safe_clinic} - please reach clinic"
            heading = "Please reach the clinic ASAP"
            detail = "It is your time to be ready. Please reach the clinic now so your consultation can start without delay."
        elif alert_type == "reach_auto":
            subject = f"You're booked at {safe_clinic} - Please reach automatically"
            heading = "Please reach the clinic automatically"
            detail = "You're second in queue. Please start heading to the clinic now as you will be called soon after the first patient."
        elif alert_type == "pre_slot_start":
            subject = f"Your appointment at {safe_clinic} starts in 15 minutes"
            heading = "Please reach the clinic ASAP"
            detail = "Your slot starts in 15 minutes. Please reach the clinic now to be ready for your turn."
        else:
            subject = f"Please reach {safe_clinic} now"
            heading = "Please reach the clinic now"
            detail = "Your turn is approaching. Please reach the clinic now."

        text_content = f"""
        Hello {safe_name},

        {detail}

        Token Number: {safe_token}
        Clinic: {safe_clinic}
        Doctor: {safe_doctor}
        Clinic Location: {safe_location}

        Thank you,
        Krama Clinic
        """.strip()

        html_content = f"""
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body {{ font-family: Arial, sans-serif; line-height: 1.6; color: #333; }}
                .container {{ max-width: 600px; margin: 0 auto; padding: 20px; }}
                .card {{ background: #f7fbfb; border: 1px solid #d8ecec; border-radius: 10px; padding: 24px; }}
                .title {{ color: #00555A; margin-bottom: 12px; }}
                .footer {{ font-size: 12px; color: #777; margin-top: 20px; }}
            </style>
        </head>
        <body>
            <div class="container">
                <div class="card">
                    <h2 class="title">{heading}</h2>
                    <p>Hello {safe_name},</p>
                    <p>{detail}</p>
                    <p><strong>Token Number:</strong> {safe_token}</p>
                    <p><strong>Clinic:</strong> {safe_clinic}</p>
                    <p><strong>Doctor:</strong> {safe_doctor}</p>
                    <p><strong>Clinic Location:</strong> {safe_location}</p>
                </div>
                <div class="footer">Krama Clinic</div>
            </div>
        </body>
        </html>
        """.strip()

        return self._send_email(to_email, subject, text_content, html_content)
    
    def _send_email(self, to_email: str, subject: str, text_content: str, html_content: str) -> bool:
        """
        Internal method to send email
        
        Args:
            to_email: Recipient email
            subject: Email subject
            text_content: Plain text content
            html_content: HTML content
            
        Returns:
            bool: Success status
        """
        logger.info(f"Attempting to send email to {to_email}, subject: {subject}")
        
        if not self.smtp_user or not self.smtp_password:
            logger.warning(
                "SMTP credentials not configured (SMTP_USERNAME/SMTP_PASSWORD). Email not sent."
            )
            return False
        
        try:
            # Create message
            msg = MIMEMultipart("alternative")
            msg["Subject"] = subject
            msg["From"] = f"{self.sender_name} <{self.sender_email}>"
            msg["To"] = to_email
            
            # Attach both plain text and HTML
            part1 = MIMEText(text_content, "plain")
            part2 = MIMEText(html_content, "html")
            msg.attach(part1)
            msg.attach(part2)
            
            # Connect to SMTP server and send
            with smtplib.SMTP(self.smtp_host, self.smtp_port, timeout=20) as server:
                server.ehlo()
                server.starttls()
                server.ehlo()
                server.login(self.smtp_user, self.smtp_password)
                server.sendmail(self.sender_email, to_email, msg.as_string())

            logger.info("Email sent successfully to %s (subject=%s)", to_email, subject)
            return True
            
        except smtplib.SMTPException as e:
            logger.error("Failed to send email to %s: %s", to_email, str(e))
            return False
        except Exception as e:
            logger.error("Unexpected error sending email to %s: %s", to_email, str(e))
            return False


# Singleton instance
email_service = EmailService()


def send_otp(to_email: str, otp_code: str) -> bool:
    """Convenience function to send OTP email"""
    return email_service.send_otp_email(to_email, otp_code)


def send_queue_alert(
    to_email: str,
    patient_name: str,
    clinic_name: str,
    alert_type: str,
    token_number: Optional[str] = None,
    doctor_name: Optional[str] = None,
    clinic_location: Optional[str] = None,
    latitude: Optional[str] = None,
    longitude: Optional[str] = None,
) -> bool:
    """Convenience function to send queue alert email"""
    return email_service.send_queue_alert_email(
        to_email,
        patient_name,
        clinic_name,
        alert_type,
        token_number,
        doctor_name,
        clinic_location,
        latitude,
        longitude,
    )


# ============ Clinic Registration Email Functions ============

def send_clinic_registration_received_email(to_email: str, clinic_name: str) -> bool:
    """
    Send email to clinic confirming their registration request has been received
    and is pending admin approval.
    """
    subject = "Registration Received - Pending Approval"
    
    html_content = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <style>
            body {{ font-family: Arial, sans-serif; line-height: 1.6; color: #333; }}
            .container {{ max-width: 600px; margin: 0 auto; padding: 20px; }}
            .header {{ background: #00555A; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }}
            .content {{ background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; }}
            .footer {{ font-size: 12px; color: #888; text-align: center; margin-top: 20px; }}
            .highlight {{ background: #e8f4f8; padding: 15px; border-left: 4px solid #00555A; margin: 20px 0; }}
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h2>Registration Received</h2>
            </div>
            <div class="content">
                <p>Dear <strong>{clinic_name}</strong>,</p>
                <p>Thank you for registering with Krama Care!</p>
                
                <div class="highlight">
                    <p><strong>Your registration request has been received and is now under review.</strong></p>
                    <p>You will receive a response within <strong>24 hours</strong> regarding the status of your application.</p>
                </div>
                
                <p>Please note that you <strong>cannot log in</strong> until your registration has been approved by our admin team.</p>
                
                <p>If you have any questions, please feel free to contact us.</p>
                
                <p>Best regards,<br>
                <strong>Krama Care Team</strong></p>
            </div>
            <div class="footer">
                <p>© 2024 Krama Care. All rights reserved.</p>
            </div>
        </div>
    </body>
    </html>
    """
    
    text_content = f"""
    Registration Received - Pending Approval
    =========================================
    
    Dear {clinic_name},
    
    Thank you for registering with Krama Care!
    
    Your registration request has been received and is now under review.
    You will receive a response within 24 hours regarding the status of your application.
    
    Please note that you cannot log in until your registration has been approved by our admin team.
    
    If you have any questions, please feel free to contact us.
    
    Best regards,
    Krama Care Team
    
    © 2024 Krama Care. All rights reserved.
    """
    
    return email_service._send_email(to_email, subject, text_content, html_content)


def send_clinic_approval_email(to_email: str, clinic_name: str, clinic_id: str) -> bool:
    """
    Send email to clinic confirming their registration has been approved.
    """
    subject = "Registration Approved - Welcome to Krama Care!"
    
    html_content = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <style>
            body {{ font-family: Arial, sans-serif; line-height: 1.6; color: #333; }}
            .container {{ max-width: 600px; margin: 0 auto; padding: 20px; }}
            .header {{ background: #28a745; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }}
            .content {{ background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; }}
            .footer {{ font-size: 12px; color: #888; text-align: center; margin-top: 20px; }}
            .success-box {{ background: #d4edda; padding: 15px; border-left: 4px solid #28a745; margin: 20px 0; }}
            .clinic-id {{ background: #fff; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-family: monospace; font-size: 16px; text-align: center; margin: 10px 0; }}
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h2>Registration Approved!</h2>
            </div>
            <div class="content">
                <p>Dear <strong>{clinic_name}</strong>,</p>
                
                <div class="success-box">
                    <p><strong>Congratulations!</strong> Your registration has been approved by our admin team.</p>
                </div>
                
                <p>You can now log in to your clinic dashboard and start managing your appointments.</p>
                
                <p><strong>Your Clinic ID:</strong></p>
                <div class="clinic-id">{clinic_id}</div>
                
                <p>Please keep this ID safe as you will need it for logging in and managing your clinic.</p>
                
                <p><a href="#" style="background: #00555A; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block; margin: 20px 0;">Go to Login</a></p>
                
                <p>Welcome to the Krama Care family!</p>
                
                <p>Best regards,<br>
                <strong>Krama Care Team</strong></p>
            </div>
            <div class="footer">
                <p>© 2024 Krama Care. All rights reserved.</p>
            </div>
        </div>
    </body>
    </html>
    """
    
    text_content = f"""
    Registration Approved - Welcome to Krama Care!
    ================================================
    
    Dear {clinic_name},
    
    Congratulations! Your registration has been approved by our admin team.
    
    You can now log in to your clinic dashboard and start managing your appointments.
    
    Your Clinic ID: {clinic_id}
    
    Please keep this ID safe as you will need it for logging in and managing your clinic.
    
    Welcome to the Krama Care family!
    
    Best regards,
    Krama Care Team
    
    © 2024 Krama Care. All rights reserved.
    """
    
    return email_service._send_email(to_email, subject, text_content, html_content)


def send_slot_push_email(to_email: str, patient_name: str, clinic_name: str, old_slot: str, new_slot: str, new_token: str = None) -> bool:
    """
    Send email to patient when they are pushed to a new slot by the clinic.
    """
    subject = f"Your appointment at {clinic_name} has been moved to next slot"

    token_info = f"<p><strong>Your new token number:</strong> {new_token}</p>" if new_token else ""
    token_info_plain = f"Your new token number: {new_token}\n" if new_token else ""

    html_content = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <style>
            body {{ font-family: Arial, sans-serif; line-height: 1.6; color: #333; }}
            .container {{ max-width: 600px; margin: 0 auto; padding: 20px; }}
            .card {{ background: #f7fbfb; border: 1px solid #d8ecec; border-radius: 10px; padding: 24px; }}
            .title {{ color: #00555A; margin-bottom: 12px; }}
            .footer {{ font-size: 12px; color: #777; margin-top: 20px; }}
            .slot-box {{ background: #fff3cd; border: 1px solid #ffc107; padding: 15px; border-radius: 4px; margin: 15px 0; }}
            .token-box {{ background: #d4edda; border: 1px solid #28a745; padding: 15px; border-radius: 4px; margin: 15px 0; text-align: center; }}
            .token-number {{ font-size: 24px; font-weight: bold; color: #28a745; }}
        </style>
    </head>
    <body>
        <div class="container">
            <div class="card">
                <h2 class="title">Appointment Moved to Next Slot</h2>
                <p>Hello {patient_name},</p>
                <p>Due to high patient volume, your appointment has been moved to the next available time slot because you did not show up for your scheduled time.</p>
                <div class="slot-box">
                    <p><strong>Original slot:</strong> {old_slot}</p>
                    <p><strong>New slot:</strong> {new_slot}</p>
                </div>
                {token_info}
                <p><strong>Note:</strong> You have been added to the end of the queue for the new slot. Please wait for your turn.</p>
                <p><strong>Clinic:</strong> {clinic_name}</p>
            </div>
            <div class="footer">Krama Clinic</div>
        </div>
    </body>
    </html>
    """

    text_content = f"""
    Appointment Moved to Next Slot
    ===============================

    Hello {patient_name},

    Due to high patient volume, your appointment has been moved to the next available time slot because you did not show up for your scheduled time.

    Original slot: {old_slot}
    New slot: {new_slot}
    {token_info_plain}
    Note: You have been added to the end of the queue for the new slot. Please wait for your turn.

    Clinic: {clinic_name}

    Thank you,
    Krama Clinic
    """

    return email_service._send_email(to_email, subject, text_content, html_content)


def send_not_served_email(to_email: str, patient_name: str, clinic_name: str, slot_name: str = None) -> bool:
    """Send email to patient when they are marked as not served (no more slots available)."""
    slot_info = f"<p><strong>Your slot:</strong> {slot_name}</p>" if slot_name else ""
    slot_info_plain = f"Your slot: {slot_name}\n" if slot_name else ""

    subject = f"Appointment Update - {clinic_name}"

    html_content = f"""
    <!DOCTYPE html>
    <html>
    <head>
    <style>
        body {{ font-family: Arial, sans-serif; line-height: 1.6; color: #333; }}
        .container {{ max-width: 600px; margin: 0 auto; padding: 20px; }}
        .card {{ background: #fff5f5; border: 1px solid #ffcccc; border-radius: 10px; padding: 24px; }}
        .title {{ color: #dc3545; margin-bottom: 12px; }}
        .footer {{ font-size: 12px; color: #777; margin-top: 20px; }}
        .info-box {{ background: #f8f9fa; border: 1px solid #dee2e6; padding: 15px; border-radius: 4px; margin: 15px 0; }}
        .button {{ display: inline-block; padding: 12px 24px; background: #00555A; color: white; text-decoration: none; border-radius: 6px; margin-top: 15px; }}
    </style>
    </head>
    <body>
    <div class="container">
    <div class="card">
        <h2 class="title">Appointment Could Not Be Completed</h2>
        <p>Hello {patient_name},</p>
        <p>Unfortunately, we were unable to serve your appointment today as there are no more available time slots.</p>
        {slot_info}
        <div class="info-box">
            <p><strong>What this means:</strong></p>
            <ul>
                <li>Your appointment has been marked as not served</li>
                <li>All time slots for today have ended or are fully booked</li>
                <li>You'll need to book a new appointment for your next visit</li>
            </ul>
        </div>
        <p>We're sorry for any inconvenience. Please try booking again tomorrow or contact the clinic directly.</p>
        <p><strong>Clinic:</strong> {clinic_name}</p>
    </div>
    <div class="footer">Krama Care</div>
    </div>
    </body>
    </html>
    """

    text_content = f"""
Appointment Could Not Be Completed
===================================

Hello {patient_name},

Unfortunately, we were unable to serve your appointment today as there are no more available time slots.

{slot_info_plain}
What this means:
- Your appointment has been marked as not served
- All time slots for today have ended or are fully booked
- You'll need to book a new appointment for your next visit

We're sorry for any inconvenience. Please try booking again tomorrow or contact the clinic directly.

Clinic: {clinic_name}

Thank you,
Krama Care
"""

    return email_service._send_email(to_email, subject, text_content, html_content)


def send_clinic_rejection_email(to_email: str, clinic_name: str, reason: str = None) -> bool:
    """
    Send email to clinic informing them their registration has been rejected.
    """
    subject = "Registration Status Update"
    
    reason_text = f"<p><strong>Reason:</strong> {reason}</p>" if reason else ""
    reason_text_plain = f"Reason: {reason}" if reason else ""
    
    html_content = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <style>
            body {{ font-family: Arial, sans-serif; line-height: 1.6; color: #333; }}
            .container {{ max-width: 600px; margin: 0 auto; padding: 20px; }}
            .header {{ background: #dc3545; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }}
            .content {{ background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; }}
            .footer {{ font-size: 12px; color: #888; text-align: center; margin-top: 20px; }}
            .notice-box {{ background: #f8d7da; padding: 15px; border-left: 4px solid #dc3545; margin: 20px 0; }}
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h2>Registration Update</h2>
            </div>
            <div class="content">
                <p>Dear <strong>{clinic_name}</strong>,</p>
                
                <div class="notice-box">
                    <p><strong>We regret to inform you that your registration request has not been approved at this time.</strong></p>
                    {reason_text}
                </div>
                
                <p>If you believe this was a mistake or would like to provide additional information, please contact our support team.</p>
                
                <p>Thank you for your interest in Krama Care.</p>
                
                <p>Best regards,<br>
                <strong>Krama Care Team</strong></p>
            </div>
            <div class="footer">
                <p>© 2024 Krama Care. All rights reserved.</p>
            </div>
        </div>
    </body>
    </html>
    """
    
    text_content = f"""
    Registration Update
    ===================
    
    Dear {clinic_name},
    
    We regret to inform you that your registration request has not been approved at this time.
    {reason_text_plain}
    
    If you believe this was a mistake or would like to provide additional information, please contact our support team.
    
    Thank you for your interest in Krama Care.

    Best regards,
    Krama Care Team

    © 2024 Krama Care. All rights reserved.
    """

    return email_service._send_email(to_email, subject, text_content, html_content)


def send_patient_report_email(
    patient_email: str,
    patient_name: str,
    clinic_name: str,
    pdf_path: str,
    notes: Optional[str] = None
) -> bool:
    """
    Send patient report email with PDF attachment.

    Args:
        patient_email: Recipient email address
        patient_name: Patient's name
        clinic_name: Clinic's name
        pdf_path: Path to the PDF file to attach
        notes: Optional notes from the clinic

    Returns:
        bool: True if email sent successfully, False otherwise
    """
    try:
        if not email_service.smtp_user or not email_service.smtp_password:
            logger.warning(
                "SMTP credentials not configured (SMTP_USERNAME/SMTP_PASSWORD). Patient report email not sent."
            )
            return False

        subject = f"Your Medical Report from {clinic_name}"

        # HTML email content
        notes_section = ""
        if notes:
            notes_section = f"""
                    <div style="background: #fff3cd; border-left: 4px solid #ffc107; padding: 20px; margin: 20px 0; border-radius: 5px;">
                        <p style="margin: 0; color: #856404;"><strong>Note from Clinic:</strong></p>
                        <p style="margin: 5px 0 0 0;">{notes}</p>
                    </div>
            """

        # Text email content
        notes_text_section = ""
        if notes:
            notes_text_section = f"Note from Clinic: {notes}\n\n"

        html_content = f"""
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Your Medical Report</title>
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 20px;">
            <div style="max-width: 600px; margin: 0 auto; background: #f9f9f9; border-radius: 10px; overflow: hidden;">
                <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center;">
                    <h1 style="margin: 0; font-size: 28px;">Your Medical Report is Ready</h1>
                    <p style="margin: 10px 0 0 0; font-size: 16px; opacity: 0.9;">From {clinic_name}</p>
                </div>

                <div style="padding: 30px;">
                    <p>Dear <strong>{patient_name}</strong>,</p>

                    <p>We are pleased to inform you that your medical report from <strong>{clinic_name}</strong> is now ready.</p>

                    <div style="background: #e8f4f8; border-left: 4px solid #2196F3; padding: 20px; margin: 20px 0; border-radius: 5px;">
                        <p style="margin: 0; color: #1976D2;"><strong>Your Report</strong></p>
                        <p style="margin: 5px 0 0 0;">Please find your medical report attached to this email as a PDF file.</p>
                    </div>

                    {notes_section}

                    <p style="margin: 20px 0;">If you have any questions about your report, please don't hesitate to contact {clinic_name} directly.</p>

                    <p>Thank you for choosing {clinic_name} for your healthcare needs.</p>

                    <p style="margin: 30px 0 0 0; color: #666; font-size: 14px;">
                        Best regards,<br>
                        <strong>{clinic_name} Team</strong>
                    </p>
                </div>

                <div style="background: #f0f0f0; padding: 20px; text-align: center; font-size: 12px; color: #888;">
                    <p style="margin: 0;">© 2024 Krama Care. All rights reserved.</p>
                </div>
            </div>
        </body>
        </html>
        """

        text_content = f"""
        Your Medical Report is Ready
        ==============================

        Dear {patient_name},

        We are pleased to inform you that your medical report from {clinic_name} is now ready.

        Please find your medical report attached to this email as a PDF file.

        {notes_text_section}
        If you have any questions about your report, please don't hesitate to contact {clinic_name} directly.

        Thank you for choosing {clinic_name} for your healthcare needs.

        Best regards,
        {clinic_name} Team

        © 2024 Krama Care. All rights reserved.
        """

        # Create email with attachment
        msg = MIMEMultipart("mixed")
        msg['From'] = email_service.sender_email
        msg['To'] = patient_email
        msg['Subject'] = subject

        body = MIMEMultipart("alternative")
        body.attach(MIMEText(text_content, "plain"))
        body.attach(MIMEText(html_content, "html"))
        msg.attach(body)

        # Attach the PDF file
        if os.path.exists(pdf_path):
            with open(pdf_path, 'rb') as f:
                part = MIMEApplication(
                    f.read(),
                    Name=os.path.basename(pdf_path)
                )
                part['Content-Disposition'] = f'attachment; filename="{os.path.basename(pdf_path)}"'
                msg.attach(part)
        else:
            logger.error(f"PDF file not found: {pdf_path}")
            return False

        # Connect to SMTP server and send
        with smtplib.SMTP(email_service.smtp_host, email_service.smtp_port, timeout=20) as server:
            server.ehlo()
            server.starttls()
            server.ehlo()
            server.login(email_service.smtp_user, email_service.smtp_password)
            server.sendmail(email_service.sender_email, patient_email, msg.as_string())

        logger.info("Patient report email sent successfully to %s", patient_email)
        return True

    except smtplib.SMTPException as e:
        logger.error("Failed to send patient report email to %s: %s", patient_email, str(e))
        return False
    except Exception as e:
        logger.error("Unexpected error sending patient report email to %s: %s", patient_email, str(e))
        return False


def send_admin_otp_email(to_email: str, otp_code: str, admin_username: str) -> bool:
    """
    Send OTP email to admin for authentication

    Args:
        to_email: Recipient email address
        otp_code: 6-digit OTP code
        admin_username: Admin username (e.g., "admin1" or "admin1 (confirmation)")

    Returns:
        bool: True if email sent successfully, False otherwise
    """
    try:
        email_service = EmailService()

        subject = f"Admin Login OTP - {admin_username}"

        # HTML email content
        html_content = f"""
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Admin Login OTP</title>
        </head>
        <body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f4f4f4;">
            <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; padding: 30px; border-radius: 10px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                <div style="text-align: center; margin-bottom: 30px;">
                    <h1 style="color: #00555A; margin: 0;">Krama Admin</h1>
                    <p style="color: #666; margin: 10px 0 0 0;">Secure Authentication</p>
                </div>

                <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 20px; text-align: center;">
                    <p style="color: #333; margin: 0 0 10px 0; font-size: 16px;">Your One-Time Password (OTP) is:</p>
                    <div style="background-color: #00555A; color: #ffffff; padding: 15px 30px; border-radius: 8px; font-size: 32px; font-weight: bold; letter-spacing: 5px; display: inline-block;">
                        {otp_code}
                    </div>
                </div>

                <div style="color: #666; font-size: 14px; line-height: 1.6;">
                    <p style="margin: 0 0 10px 0;">This OTP will expire in <strong>10 minutes</strong>.</p>
                    <p style="margin: 0 0 10px 0;">If you didn't request this OTP, please ignore this email.</p>
                    <p style="margin: 0;">For security reasons, never share your OTP with anyone.</p>
                </div>

                <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e0e0e0; text-align: center; color: #999; font-size: 12px;">
                    <p style="margin: 0;">This is an automated email from Krama Admin System.</p>
                    <p style="margin: 5px 0 0 0;">© 2024 Krama Care. All rights reserved.</p>
                </div>
            </div>
        </body>
        </html>
        """

        # Plain text version
        text_content = f"""
        Krama Admin - Secure Authentication

        Your One-Time Password (OTP) is: {otp_code}

        This OTP will expire in 10 minutes.

        If you didn't request this OTP, please ignore this email.
        For security reasons, never share your OTP with anyone.

        This is an automated email from Krama Admin System.
        © 2024 Krama Care. All rights reserved.
        """

        # Create email
        msg = MIMEMultipart()
        msg['From'] = email_service.sender_email
        msg['To'] = to_email
        msg['Subject'] = subject

        # Attach HTML and text parts
        part1 = MIMEText(text_content, "plain")
        part2 = MIMEText(html_content, "html")
        msg.attach(part1)
        msg.attach(part2)

        # Connect to SMTP server and send
        with smtplib.SMTP(email_service.smtp_host, email_service.smtp_port, timeout=20) as server:
            server.ehlo()
            server.starttls()
            server.ehlo()
            server.login(email_service.smtp_user, email_service.smtp_password)
            server.sendmail(email_service.sender_email, to_email, msg.as_string())

        logger.info("Admin OTP email sent successfully to %s for %s", to_email, admin_username)
        return True

    except smtplib.SMTPException as e:
        logger.error("Failed to send admin OTP email to %s: %s", to_email, str(e))
        return False
    except Exception as e:
        logger.error("Unexpected error sending admin OTP email to %s: %s", to_email, str(e))
        return False
